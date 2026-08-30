import { useEffect, useRef, useState } from 'react'
import { useSelector } from '@tanstack/react-store'
import { useHotkeys, useKeyHold } from '@tanstack/react-hotkeys'

import { Grid } from './grid.tsx'
import {
  FurnitureShape,
  OpeningShape,
  OpeningTarget,
  RoomFloor,
  RoomWalls,
  SharedWalls,
} from './shapes.tsx'
import {
  DraftOverlay,
  FurnitureEditor,
  FurnitureLabels,
  NameEditor,
  OpeningEditor,
  RectPreview,
  RoomEditor,
  RoomLabels,
  SnapGuides,
  WALL_GRAB,
  WallDimensions,
} from './overlay.tsx'

import { activeSnapStep, plannerStore } from '#/lib/planner/store.ts'
import { furnitureNames, wallLabels } from '#/lib/planner/dimensions.ts'
import { sharedSpansOf, wallPath } from '#/lib/planner/walls.ts'
import {
  SNAP_REACH_PX,
  alignTo,
  alignWall,
  snapTargets,
  wallAxis,
} from '#/lib/planner/snapping.ts'
import { OPENING_PRESETS } from '#/lib/planner/presets.ts'
import {
  EDIT_KEYS,
  NUDGE_COARSE,
  NUDGE_KEYS,
  OPENING_KEYS,
  TOOL_KEYS,
} from '#/lib/planner/shortcuts.ts'
import {
  clampT,
  fittedWidth,
  nearestWall,
  openingEnds,
  pointOnWall,
  openingWall,
  projectT,
  wallAt,
} from '#/lib/planner/openings.ts'
import {
  distance,
  furnitureCorners,
  pointInPolygon,
  polygonBounds,
  polygonCentroid,
  resizeRotated,
  rotationFor,
  screenToWorld,
  slideWall,
  snapPoint,
  snapValue,
  translatePolygon,
  worldToScreen,
} from '#/lib/planner/geometry.ts'

import type {
  Furniture,
  Handle,
  Opening,
  OpeningKind,
  Point,
  Rename,
  Room,
  Viewport,
} from '#/lib/planner/types.ts'
import type { DrawTool } from '#/lib/planner/shortcuts.ts'
import type { Hotkey } from '@tanstack/react-hotkeys'
import type { Guide } from '#/lib/planner/snapping.ts'
import type { Wall } from '#/lib/planner/openings.ts'

/** How close, in screen pixels, a click must be to close the polygon. */
const CLOSE_PX = 12
/** How near a wall the pointer must come, in screen pixels, to open it up. */
const WALL_REACH_PX = 44
/** How far above a room's own label the field to rename it sits, in pixels. */
const NAME_LIFT = 6

/**
 * What a click at `world` has landed on, of the things that carry a name of
 * their own. Whatever is drawn last is drawn on top, so the search runs back
 * from the end of each list, and furniture is asked before the floor it stands
 * on — the same order the pointer meets them in.
 *
 * A click on a wall itself is nobody's name: it belongs to the wall, whether
 * that is one to be broken in two or a door cut into it, neither of which is
 * called anything of its own. `reach` is how near counts as on it.
 */
function nameableAt(
  rooms: Array<Room>,
  furniture: Array<Furniture>,
  world: Point,
  reach: number,
): Rename {
  for (let i = furniture.length - 1; i >= 0; i--) {
    const item = furniture[i]
    if (pointInPolygon(world, furnitureCorners(item))) {
      return { type: 'furniture', id: item.id }
    }
  }
  if (nearestWall(rooms, world, reach)) return null
  for (let i = rooms.length - 1; i >= 0; i--) {
    if (pointInPolygon(world, rooms[i].points)) {
      return { type: 'room', id: rooms[i].id }
    }
  }
  return null
}

/**
 * Where the name being typed over is written on the plan, and what it says as
 * it stands: over a room's own label, or in the middle of a piece of
 * furniture, which carries no label but is named all the same.
 *
 * Null once whatever was being renamed has gone from under the field.
 */
function editedName(
  rooms: Array<Room>,
  furniture: Array<Furniture>,
  renaming: Rename,
  viewport: Viewport,
): { key: string; at: Point; name: string } | null {
  if (!renaming) return null
  const key = `${renaming.type}:${renaming.id}`
  if (renaming.type === 'room') {
    const room = rooms.find((r) => r.id === renaming.id)
    if (!room) return null
    const at = worldToScreen(polygonCentroid(room.points), viewport)
    return { key, at: { x: at.x, y: at.y - NAME_LIFT }, name: room.name }
  }
  const item = furniture.find((f) => f.id === renaming.id)
  if (!item) return null
  return {
    key,
    at: worldToScreen({ x: item.x, y: item.y }, viewport),
    name: item.name,
  }
}

type Drag =
  | {
      mode: 'pan'
      startScreen: Point
      startTx: number
      startTy: number
      moved: boolean
    }
  | { mode: 'move-furniture'; id: string; grab: Point; origin: Furniture }
  | { mode: 'move-room'; id: string; grab: Point; origin: Array<Point> }
  | { mode: 'resize'; id: string; handle: Handle }
  | { mode: 'rotate'; id: string }
  | { mode: 'vertex'; roomId: string; index: number }
  | {
      mode: 'wall'
      roomId: string
      index: number
      grab: Point
      origin: Array<Point>
    }
  | { mode: 'opening'; id: string }
  | { mode: 'opening-end'; id: string; end: 'start' | 'end' }
  | { mode: 'rect' }

export function Canvas() {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const dragRef = useRef<Drag | null>(null)
  // Space held turns any drag into a pan. The tracker keeps the key's state
  // itself and clears it when the window loses focus, so a space held on the
  // way out never comes back stuck down.
  const spaceHeld = useKeyHold(EDIT_KEYS.pan)

  const {
    rooms,
    furniture,
    openings,
    selection,
    renaming,
    tool,
    openingKind,
    units,
    viewport,
    draft,
    rect: rectDraft,
    size,
  } = useSelector(plannerStore)

  const [cursor, setCursor] = useState<Point | null>(null)
  const [panning, setPanning] = useState(false)
  /** The lines the thing being dragged has locked onto, while it is dragged. */
  const [guides, setGuides] = useState<Array<Guide>>([])
  /** The wall the opening tool is hovering, and where along it. */
  const [ghost, setGhost] = useState<{
    roomId: string
    wall: number
    t: number
  } | null>(null)

  const actions = plannerStore.actions

  // Handlers read live state off the store rather than closing over a render's
  // snapshot, so a drag never works against stale coordinates.
  const toScreen = (event: { clientX: number; clientY: number }): Point => {
    const rect = svgRef.current?.getBoundingClientRect()
    return rect
      ? { x: event.clientX - rect.left, y: event.clientY - rect.top }
      : { x: 0, y: 0 }
  }

  const toWorld = (event: { clientX: number; clientY: number }): Point =>
    screenToWorld(toScreen(event), plannerStore.state.viewport)

  /**
   * Where a point of the plan's own geometry lands: onto the nearest wall line
   * already in the plan if one is within reach, and onto the grid otherwise —
   * per axis, so a corner can go flush with a neighbour one way while still
   * sitting on a round number the other. `exclude` is the room the point
   * belongs to, which must not pull on itself.
   */
  const settle = (p: Point, exclude?: string): Point => {
    const state = plannerStore.state
    const fit = alignTo(
      [p],
      snapTargets(state.rooms, exclude),
      SNAP_REACH_PX / state.viewport.scale,
    )
    setGuides(fit.guides)
    const step = activeSnapStep(state)
    const grid = snapPoint(p, step)
    return {
      x: fit.dx === null ? grid.x : p.x + fit.dx,
      y: fit.dy === null ? grid.y : p.y + fit.dy,
    }
  }

  /**
   * How far a wall being pushed really goes, measured along its own normal:
   * onto a wall line already in the plan if one is within reach, and onto the
   * grid otherwise. A wall square to the page lands on a round coordinate, the
   * way a corner does; one on the diagonal has no coordinate to be round in, so
   * it lands a round distance from where it started instead.
   */
  const settleWall = (frame: Wall, roomId: string, across: number): number => {
    const state = plannerStore.state
    const slid = [frame.a, frame.b].map((p) => ({
      x: p.x + frame.normal.x * across,
      y: p.y + frame.normal.y * across,
    }))
    const fit = alignWall(
      slid,
      frame.normal,
      snapTargets(state.rooms, roomId),
      SNAP_REACH_PX / state.viewport.scale,
    )
    setGuides(fit.guides)
    if (fit.pull !== null) return across + fit.pull

    const step = activeSnapStep(state)
    if (step === null) return across
    const axis = wallAxis(frame.normal)
    if (axis === null) return snapValue(across, step)
    const landed = snapValue(slid[0][axis], step)
    return across + (landed - slid[0][axis]) / frame.normal[axis]
  }

  const capture = (pointerId: number) => {
    svgRef.current?.setPointerCapture(pointerId)
  }

  // The room tool leaves its guides up between clicks, which is what makes them
  // useful while a polygon is being traced. Putting the tool down clears them.
  useEffect(() => setGuides([]), [tool])

  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        plannerStore.actions.setSize(
          entry.contentRect.width,
          entry.contentRect.height,
        )
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // React registers onWheel passively, so preventDefault from JSX would not stop
  // the browser's own pinch-zoom. Bind it directly instead.
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = el.getBoundingClientRect()
      const anchor = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      }
      const { viewport: vp } = plannerStore.state
      if (event.ctrlKey || event.metaKey) {
        plannerStore.actions.zoomAtPoint(
          anchor,
          vp.scale * Math.exp(-event.deltaY * 0.01),
        )
      } else {
        plannerStore.actions.panBy(-event.deltaX, -event.deltaY)
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  /**
   * Escape backs out of whatever reaches furthest in: the draft first, then
   * the rectangle, then the tool, and only then the selection.
   */
  const cancel = () => {
    const state = plannerStore.state
    if (state.draft) actions.cancelDraft()
    else if (state.rect) actions.cancelRect()
    else if (state.tool !== 'select') actions.setTool('select')
    else actions.select(null)
  }

  const nudge = (delta: readonly [number, number], reach: number) => {
    const step = (activeSnapStep(plannerStore.state) ?? 1) * reach
    actions.nudgeSelection(delta[0] * step, delta[1] * step)
  }

  // Registrations rather than a switch over `event.key`: the manager holds the
  // one listener and resolves Mod to ⌘ or Ctrl per platform.
  useHotkeys(
    [
      { hotkey: EDIT_KEYS.undo, callback: () => actions.undo() },
      { hotkey: EDIT_KEYS.redo, callback: () => actions.redo() },
      { hotkey: EDIT_KEYS.redoAlt, callback: () => actions.redo() },
      // With nothing selected there is nothing here to copy. A disabled
      // registration is passed over before it can take the event, so the
      // browser's own copy — of whatever text is selected on the page — is left
      // to go through.
      {
        hotkey: EDIT_KEYS.copy,
        callback: () => actions.copySelection(),
        options: { enabled: selection !== null },
      },
      { hotkey: EDIT_KEYS.paste, callback: () => actions.paste() },
      // Taken whether or not it does anything, so that the plan never answers a
      // duplicate with the browser's bookmark dialogue.
      {
        hotkey: EDIT_KEYS.duplicate,
        callback: () => actions.duplicateSelection(),
      },
      { hotkey: EDIT_KEYS.cancel, callback: cancel },
      // Enter is left to the browser until there is a draft for it to close.
      {
        hotkey: EDIT_KEYS.commit,
        callback: () => actions.commitDraft(),
        options: { enabled: draft !== null },
      },
      // A draft gives up its last corner before the plan gives up anything.
      ...[EDIT_KEYS.remove, EDIT_KEYS.removeAlt].map((hotkey) => ({
        hotkey,
        callback: () =>
          plannerStore.state.draft
            ? actions.popDraftPoint()
            : actions.deleteSelected(),
      })),
      // Space is held rather than struck, and `useKeyHold` below is what reads
      // it. It is registered all the same so that the press is taken off the
      // page, where it would otherwise click whichever button has the focus.
      { hotkey: EDIT_KEYS.pan, callback: () => {} },
      ...(Object.entries(TOOL_KEYS) as Array<[DrawTool, Hotkey]>).map(
        ([value, hotkey]) => ({
          hotkey,
          callback: () => actions.setTool(value),
        }),
      ),
      ...(Object.entries(OPENING_KEYS) as Array<[OpeningKind, Hotkey]>).map(
        ([kind, hotkey]) => ({
          hotkey,
          callback: () => actions.setOpeningTool(kind),
        }),
      ),
      ...NUDGE_KEYS.flatMap(({ key, shifted, delta }) => [
        {
          hotkey: key,
          callback: () => nudge(delta, 1),
          options: { enabled: selection !== null },
        },
        {
          hotkey: shifted,
          callback: () => nudge(delta, NUDGE_COARSE),
          options: { enabled: selection !== null },
        },
        // A run of arrow-key repeats reads as one nudge, which ends on release.
        // Shift may have been let go of by then or not, so both endings are
        // listened for — and each shares its key with the press it closes, which
        // is a conflict only in the sense that the manager cannot tell the two
        // apart by name.
        ...[key, shifted].map((hotkey) => ({
          hotkey,
          callback: () => actions.sealHistory(),
          options: {
            eventType: 'keyup' as const,
            conflictBehavior: 'allow' as const,
          },
        })),
      ]),
    ],
    // A field with the focus keeps its keys: the name box is where Escape
    // abandons a rename and ⌘Z takes back a letter, neither of which the plan
    // has any business answering. The library would otherwise let those two
    // through on the grounds that they are rarely meant for the text.
    { ignoreInputs: true },
  )

  function beginPan(event: React.PointerEvent) {
    const vp = plannerStore.state.viewport
    dragRef.current = {
      mode: 'pan',
      startScreen: toScreen(event),
      startTx: vp.tx,
      startTy: vp.ty,
      moved: false,
    }
    setPanning(true)
    capture(event.pointerId)
  }

  function onCanvasPointerDown(event: React.PointerEvent) {
    const state = plannerStore.state
    if (event.button === 1 || spaceHeld || state.tool === 'select') {
      beginPan(event)
      return
    }
    if (event.button !== 0) return

    // Opening tool: the click lands on whichever wall the ghost has found.
    if (state.tool === 'opening') {
      const spot = nearestWall(
        state.rooms,
        toWorld(event),
        WALL_REACH_PX / state.viewport.scale,
      )
      if (spot) {
        actions.addOpening(
          state.openingKind,
          spot.roomId,
          spot.wall,
          snapAlong(spot.roomId, spot.wall, spot.t),
        )
        setGhost(null)
      }
      return
    }

    // Rectangle tool: drag out the two opposite corners in one gesture.
    if (state.tool === 'rect') {
      actions.beginRect(settle(toWorld(event)))
      dragRef.current = { mode: 'rect' }
      capture(event.pointerId)
      return
    }

    // Room tool: each click drops a corner, and clicking the first one closes.
    if (state.draft && state.draft.length >= 3) {
      const first = worldToScreen(state.draft[0], state.viewport)
      if (distance(toScreen(event), first) <= CLOSE_PX) {
        actions.commitDraft()
        return
      }
    }
    actions.addDraftPoint(settle(toWorld(event)))
  }

  /**
   * Where along a wall a fraction lands once the snap step has had its say.
   * An opening slides along one line, so the step is applied to the distance
   * from the wall's first corner rather than to a point on the grid.
   */
  function snapAlong(roomId: string, wall: number, t: number): number {
    const state = plannerStore.state
    const room = state.rooms.find((r) => r.id === roomId)
    const frame = room && wallAt(room.points, wall)
    const step = activeSnapStep(state)
    if (!frame || step === null) return t
    return snapValue(t * frame.length, step) / frame.length
  }

  function onPointerMove(event: React.PointerEvent) {
    const state = plannerStore.state
    if (state.tool === 'room') setCursor(settle(toWorld(event)))
    if (state.tool === 'opening') {
      const spot = nearestWall(
        state.rooms,
        toWorld(event),
        WALL_REACH_PX / state.viewport.scale,
      )
      setGhost(
        spot && {
          ...spot,
          t: snapAlong(spot.roomId, spot.wall, spot.t),
        },
      )
    }

    const drag = dragRef.current
    if (!drag) return
    const world = toWorld(event)

    switch (drag.mode) {
      case 'pan': {
        const screen = toScreen(event)
        const dx = screen.x - drag.startScreen.x
        const dy = screen.y - drag.startScreen.y
        if (Math.hypot(dx, dy) > 3) drag.moved = true
        actions.setViewport({
          ...state.viewport,
          tx: drag.startTx + dx,
          ty: drag.startTy + dy,
        })
        break
      }
      case 'move-furniture': {
        let x = drag.origin.x + (world.x - drag.grab.x)
        let y = drag.origin.y + (world.y - drag.grab.y)
        const step = activeSnapStep(state)
        if (step !== null) {
          // Snap the unrotated top-left so edges land on grid lines.
          const topLeft = snapPoint(
            { x: x - drag.origin.w / 2, y: y - drag.origin.h / 2 },
            step,
          )
          x = topLeft.x + drag.origin.w / 2
          y = topLeft.y + drag.origin.h / 2
        }
        actions.updateFurniture(drag.id, { x, y })
        break
      }
      case 'move-room': {
        // The whole outline is offered to the plan at once, so any of the
        // room's corners or faces may be the one that finds a line to lock
        // onto — which is what lets a room be dragged up against a neighbour
        // by whichever of its edges happens to be facing it.
        const points = translatePolygon(
          drag.origin,
          world.x - drag.grab.x,
          world.y - drag.grab.y,
        )
        const fit = alignTo(
          points,
          snapTargets(state.rooms, drag.id),
          SNAP_REACH_PX / state.viewport.scale,
        )
        setGuides(fit.guides)
        const step = activeSnapStep(state)
        const bounds = polygonBounds(points)
        const grid =
          step === null
            ? { x: bounds.x, y: bounds.y }
            : snapPoint({ x: bounds.x, y: bounds.y }, step)
        actions.updateRoom(drag.id, {
          points: translatePolygon(
            points,
            fit.dx ?? grid.x - bounds.x,
            fit.dy ?? grid.y - bounds.y,
          ),
        })
        break
      }
      case 'resize': {
        const item = state.furniture.find((f) => f.id === drag.id)
        if (item) {
          actions.updateFurniture(
            drag.id,
            resizeRotated(item, drag.handle, world, activeSnapStep(state)),
          )
        }
        break
      }
      case 'rotate': {
        const item = state.furniture.find((f) => f.id === drag.id)
        if (item) {
          actions.updateFurniture(drag.id, {
            rotation: rotationFor(item, world, state.snap || event.shiftKey),
          })
        }
        break
      }
      case 'vertex': {
        actions.moveVertex(drag.roomId, drag.index, settle(world, drag.roomId))
        break
      }
      case 'wall': {
        // The wall's frame comes from where it stood when the drag began, so
        // the way it travels cannot drift as it goes, and the outline is built
        // afresh from that same starting shape each frame rather than pushed
        // again and again from wherever the last frame left it.
        const frame = wallAt(drag.origin, drag.index)
        if (!frame) break
        const across =
          (world.x - drag.grab.x) * frame.normal.x +
          (world.y - drag.grab.y) * frame.normal.y
        actions.moveWall(
          drag.roomId,
          drag.index,
          slideWall(
            drag.origin,
            drag.index,
            settleWall(frame, drag.roomId, across),
          ),
        )
        break
      }
      case 'opening': {
        const opening = state.openings.find((o) => o.id === drag.id)
        const wall = opening && openingWall(state.rooms, opening)
        if (!opening || !wall) break
        actions.updateOpening(drag.id, {
          t: snapAlong(opening.roomId, opening.wall, projectT(wall, world)),
        })
        break
      }
      case 'opening-end': {
        // One jamb follows the pointer and the other stays where it is, so the
        // width and the centre both come out of where the two now stand.
        const opening = state.openings.find((o) => o.id === drag.id)
        const wall = opening && openingWall(state.rooms, opening)
        if (!opening || !wall) break
        const ends = openingEnds(wall, opening)
        const fixed =
          projectT(wall, drag.end === 'start' ? ends.end : ends.start) *
          wall.length
        const step = activeSnapStep(state)
        const moved = projectT(wall, world) * wall.length
        const along = step === null ? moved : snapValue(moved, step)
        const width = fittedWidth(Math.abs(along - fixed), wall.length)
        actions.updateOpening(drag.id, {
          width,
          t: clampT((along + fixed) / 2 / wall.length, width, wall.length),
        })
        break
      }
      case 'rect': {
        actions.updateRect(settle(world))
        break
      }
    }
  }

  function onPointerUp(event: React.PointerEvent) {
    const drag = dragRef.current
    // A pan that never moved was really just a click on empty space.
    if (drag?.mode === 'pan' && !drag.moved && !spaceHeld) {
      actions.select(null)
    }
    if (drag?.mode === 'rect') actions.commitRect()
    if (drag) actions.sealHistory()
    dragRef.current = null
    setPanning(false)
    setGuides([])
    if (svgRef.current?.hasPointerCapture(event.pointerId)) {
      svgRef.current.releasePointerCapture(event.pointerId)
    }
  }

  /**
   * Everything a double-click does: closing an outline being traced; breaking
   * a wall of the selected room in two — a corner dropped where the wall was
   * double-clicked, which is the only way to give a room more sides than it
   * was drawn with; and, anywhere else, putting the name of whatever was
   * clicked up to be typed over.
   *
   * None of this is wired to the shapes themselves, because by the time the
   * second click lands there is no telling what was hit: the first press
   * captured the pointer to this canvas, and a captured pointer sends its
   * click — and the double-click built from it — to whatever holds the
   * capture. So the canvas measures the pointer against the plan itself, in
   * the order the pointer would have met it: the selected room's walls first,
   * at the same reach their grab bands are drawn at, and then whatever the
   * click fell inside. The corner a break adds is put on the wall rather than
   * under the pointer, which may be a few pixels off it: a wall that kinked
   * the moment it gained a corner would be showing the aim of the click rather
   * than the break.
   */
  function onDoubleClick(event: React.MouseEvent) {
    const state = plannerStore.state
    if (state.tool === 'room' && state.draft) {
      // The second click already added a duplicate vertex; drop it and close.
      actions.popDraftPoint()
      actions.commitDraft()
      return
    }
    if (state.tool !== 'select') return
    const world = toWorld(event)

    const room =
      state.selection?.type === 'room'
        ? state.rooms.find((r) => r.id === state.selection?.id)
        : undefined
    const spot =
      room && nearestWall([room], world, WALL_GRAB / 2 / state.viewport.scale)
    const frame = room && spot && wallAt(room.points, spot.wall)
    if (room && spot && frame) {
      actions.insertVertex(
        room.id,
        spot.wall,
        settle(pointOnWall(frame, spot.t), room.id),
      )
      actions.sealHistory()
      // `settle` puts up the guides a drag would want; there is no drag here.
      setGuides([])
      return
    }

    const target = nameableAt(
      state.rooms,
      state.furniture,
      world,
      WALL_GRAB / 2 / state.viewport.scale,
    )
    if (target) actions.beginRename(target.type, target.id)
  }

  /**
   * Take a typed name. What it belongs to is read off the store rather than
   * closed over, so a name arriving late — committed as the field was already
   * being put away — cannot land on whatever is being renamed now, or on
   * something that has since been deleted.
   */
  function commitRename(name: string) {
    const target = plannerStore.state.renaming
    if (!target) return
    if (target.type === 'room') actions.updateRoom(target.id, { name })
    else actions.updateFurniture(target.id, { name })
    // A rename is one step to undo, and the next one starts a step of its own.
    actions.sealHistory()
    actions.endRename()
  }

  function onRoomPointerDown(room: Room, event: React.PointerEvent) {
    if (event.button === 1 || spaceHeld) return beginPan(event)
    if (event.button !== 0) return
    event.stopPropagation()
    actions.select({ type: 'room', id: room.id })
    dragRef.current = {
      mode: 'move-room',
      id: room.id,
      grab: toWorld(event),
      origin: room.points,
    }
    capture(event.pointerId)
  }

  function onFurniturePointerDown(item: Furniture, event: React.PointerEvent) {
    if (event.button === 1 || spaceHeld) return beginPan(event)
    if (event.button !== 0) return
    event.stopPropagation()
    actions.select({ type: 'furniture', id: item.id })
    dragRef.current = {
      mode: 'move-furniture',
      id: item.id,
      grab: toWorld(event),
      origin: item,
    }
    capture(event.pointerId)
  }

  function onResizeHandleDown(handle: Handle, event: React.PointerEvent) {
    event.stopPropagation()
    const current = plannerStore.state.selection
    if (current?.type !== 'furniture') return
    dragRef.current = { mode: 'resize', id: current.id, handle }
    capture(event.pointerId)
  }

  function onRotateHandleDown(event: React.PointerEvent) {
    event.stopPropagation()
    const current = plannerStore.state.selection
    if (current?.type !== 'furniture') return
    dragRef.current = { mode: 'rotate', id: current.id }
    capture(event.pointerId)
  }

  function onOpeningPointerDown(opening: Opening, event: React.PointerEvent) {
    if (event.button === 1 || spaceHeld) return beginPan(event)
    if (event.button !== 0) return
    event.stopPropagation()
    actions.select({ type: 'opening', id: opening.id })
    dragRef.current = { mode: 'opening', id: opening.id }
    capture(event.pointerId)
  }

  function onOpeningEndDown(end: 'start' | 'end', event: React.PointerEvent) {
    event.stopPropagation()
    const current = plannerStore.state.selection
    if (current?.type !== 'opening') return
    dragRef.current = { mode: 'opening-end', id: current.id, end }
    capture(event.pointerId)
  }

  function onVertexDown(index: number, event: React.PointerEvent) {
    event.stopPropagation()
    const current = plannerStore.state.selection
    if (current?.type !== 'room') return
    dragRef.current = { mode: 'vertex', roomId: current.id, index }
    capture(event.pointerId)
  }

  /** Take hold of a whole side of the selected room, to push it across. */
  function onWallDown(index: number, event: React.PointerEvent) {
    if (event.button === 1 || spaceHeld) return beginPan(event)
    if (event.button !== 0) return
    event.stopPropagation()
    const current = plannerStore.state.selection
    if (current?.type !== 'room') return
    const room = plannerStore.state.rooms.find((r) => r.id === current.id)
    if (!room) return
    dragRef.current = {
      mode: 'wall',
      roomId: current.id,
      index,
      grab: toWorld(event),
      origin: room.points,
    }
    capture(event.pointerId)
  }

  const selectedRoom =
    selection?.type === 'room'
      ? rooms.find((r) => r.id === selection.id)
      : undefined
  const selectedFurniture =
    selection?.type === 'furniture'
      ? furniture.find((f) => f.id === selection.id)
      : undefined

  // Every opening paired with the wall it is drawn along; one whose wall has
  // gone — a room mid-edit — simply drops out of the drawing.
  const placed = openings.flatMap((opening) => {
    const wall = openingWall(rooms, opening)
    return wall ? [{ opening, wall }] : []
  })
  const selectedOpening =
    selection?.type === 'opening'
      ? placed.find(({ opening }) => opening.id === selection.id)
      : undefined

  const ghostWall =
    ghost &&
    wallAt(rooms.find((r) => r.id === ghost.roomId)?.points ?? [], ghost.wall)

  const nearFirst =
    !!draft &&
    draft.length >= 3 &&
    !!cursor &&
    distance(
      worldToScreen(cursor, viewport),
      worldToScreen(draft[0], viewport),
    ) <= CLOSE_PX

  // One layout, shared: the wall dimensions are drawn from it, and the
  // selection's own readout reads it to keep out of their way.
  const dimensions = wallLabels(
    rooms,
    furniture,
    openings,
    viewport,
    units,
    size,
  )

  // Where each item's own name is written across it, which is worked out the
  // same way and against the same room labels.
  const names = furnitureNames(rooms, furniture, viewport, units)

  // Everything already written on the plan by the time a selection's own
  // readout looks for somewhere to sit. The order is what settles a clash: the
  // names take their places, the dimensions work around the footprints they sit
  // in, and the readout — the one label the selection brought with it — gives
  // way to both.
  const written = [
    ...names.map((label) => label.box),
    ...dimensions.map((label) => label.box),
  ]

  // Every room's walls, with the openings of any room sharing them already cut
  // through. Recomputed each render, as the dimensions are: the plans this
  // holds are a handful of rooms, and walls that lagged a drag by a frame would
  // read as the rooms coming apart.
  const walls = rooms.map((room) => ({
    id: room.id,
    d: wallPath(rooms, openings, room),
  }))

  // Where the name being typed over stands on the page, if one is: read on
  // every render, so the field rides along with a pan or a zoom.
  const rename = editedName(rooms, furniture, renaming, viewport)

  const cursorClass = panning
    ? 'cursor-grabbing'
    : tool === 'select'
      ? 'cursor-default'
      : 'cursor-crosshair'

  return (
    <svg
      ref={svgRef}
      width="100%"
      height="100%"
      className={`block touch-none select-none ${cursorClass}`}
      onPointerDown={onCanvasPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => {
        setGhost(null)
        setGuides([])
      }}
      onDoubleClick={onDoubleClick}
    >
      <Grid viewport={viewport} units={units} />

      <g
        transform={`translate(${viewport.tx} ${viewport.ty}) scale(${viewport.scale})`}
        className={tool === 'select' ? undefined : 'pointer-events-none'}
      >
        {/*
          Floors first, all of them, and the walls afterwards in one pass over
          the lot. A wall belongs to the plan rather than to a room — the one
          between two rooms is a single wall — so it must never be painted over
          by a neighbour's floor, which is what drawing each room whole in turn
          would do.
        */}
        {rooms.map((room) => (
          <RoomFloor
            key={room.id}
            room={room}
            selected={room.id === selection?.id}
            onPointerDown={(event) => onRoomPointerDown(room, event)}
          />
        ))}
        {/*
          Openings are picked up from under the furniture but drawn over it: a
          sofa against a wall keeps its own clicks, while the swing it is
          standing in stays in plain sight.
        */}
        {placed.map(({ opening, wall }) => (
          <OpeningTarget
            key={opening.id}
            opening={opening}
            wall={wall}
            onPointerDown={(event) => onOpeningPointerDown(opening, event)}
          />
        ))}
        {furniture.map((item) => (
          <FurnitureShape
            key={item.id}
            item={item}
            selected={item.id === selection?.id}
            onPointerDown={(event) => onFurniturePointerDown(item, event)}
          />
        ))}
        {/*
          The walls go down over the furniture too. The band's inner face is
          where a room really stops, so a sofa shoved against a wall wants
          trimming by it rather than sitting on top of it.
        */}
        <g className="pointer-events-none">
          {walls.map((wall) => (
            <RoomWalls key={wall.id} d={wall.d} scale={viewport.scale} />
          ))}
          {selectedRoom && (
            <SharedWalls
              room={selectedRoom}
              spans={sharedSpansOf(rooms, openings, selectedRoom.id)}
              scale={viewport.scale}
            />
          )}
        </g>
        <g className="pointer-events-none">
          {placed.map(({ opening, wall }) => (
            <OpeningShape
              key={opening.id}
              opening={opening}
              wall={wall}
              selected={opening.id === selection?.id}
            />
          ))}
          {ghost && ghostWall && (
            <OpeningShape
              ghost
              wall={ghostWall}
              opening={{
                id: 'ghost',
                kind: openingKind,
                roomId: ghost.roomId,
                wall: ghost.wall,
                t: ghost.t,
                width: OPENING_PRESETS[openingKind].width,
                hinge: 'start',
                swing: 'in',
              }}
            />
          )}
        </g>
      </g>

      <RoomLabels
        rooms={rooms}
        viewport={viewport}
        units={units}
        renaming={renaming?.type === 'room' ? renaming.id : undefined}
      />
      <FurnitureLabels
        labels={names}
        renaming={renaming?.type === 'furniture' ? renaming.id : undefined}
      />
      <WallDimensions labels={dimensions} />
      <SnapGuides guides={guides} viewport={viewport} />

      {tool === 'select' && selectedRoom && (
        <RoomEditor
          room={selectedRoom}
          viewport={viewport}
          onVertexDown={onVertexDown}
          onWallDown={onWallDown}
        />
      )}
      {tool === 'select' && selectedFurniture && (
        <FurnitureEditor
          item={selectedFurniture}
          viewport={viewport}
          units={units}
          avoid={written}
          onHandleDown={onResizeHandleDown}
          onRotateDown={onRotateHandleDown}
        />
      )}
      {tool === 'select' && selectedOpening && (
        <OpeningEditor
          opening={selectedOpening.opening}
          wall={selectedOpening.wall}
          viewport={viewport}
          units={units}
          avoid={written}
          onEndDown={onOpeningEndDown}
        />
      )}
      {rectDraft && (
        <RectPreview rect={rectDraft} viewport={viewport} units={units} />
      )}
      {draft && (
        <DraftOverlay
          draft={draft}
          cursor={cursor}
          viewport={viewport}
          units={units}
          nearFirst={nearFirst}
        />
      )}
      {/* Last, so the field is over everything it is being typed on top of. */}
      {rename && (
        <NameEditor
          key={rename.key}
          at={rename.at}
          value={rename.name}
          onCommit={commitRename}
          onCancel={actions.endRename}
        />
      )}
    </svg>
  )
}
