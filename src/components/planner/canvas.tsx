import { formatMeasurementMessage } from '#/lib/planner/units.ts'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSelector } from '@tanstack/react-store'
import { useHotkeys, useKeyHold } from '@tanstack/react-hotkeys'
import { toast } from 'sonner'

import { Grid } from './grid.tsx'
import { UnderlayImage, useBlobUrl } from './underlay.tsx'
import {
  EnclosureFloor,
  FurnitureShape,
  OpeningShape,
  OpeningTarget,
  RunWalls,
  SelectedWall,
  SharedWalls,
} from './shapes.tsx'
import {
  Clearances,
  DraftOverlay,
  FurnitureEditor,
  EnclosureLabels,
  FurnitureLabels,
  NameEditor,
  OpeningEditor,
  RectPreview,
  RunEditor,
  SnapGuides,
  WALL_GRAB,
  WallDimensions,
} from './overlay.tsx'

import { activeSnapStep, plannerStore } from '#/lib/planner/store.ts'
import {
  enclosureAt,
  enclosureGroup,
  enclosuresOf,
} from '#/lib/planner/enclosures.ts'
import {
  closingIssue,
  draftPoints,
  nearestOpenEnd,
  straightPoint,
} from '#/lib/planner/drawing.ts'
import { snapDrawingPoint } from '#/lib/planner/drawingSnap.ts'
import type { DrawingSnap } from '#/lib/planner/drawingSnap.ts'
import type { Enclosure, EnclosureGroup } from '#/lib/planner/enclosures.ts'
import { underlayStore } from '#/lib/planner/underlay.ts'
import { clearancesFor } from '#/lib/planner/clearances.ts'
import { DEFAULT_CLOSET, placeCloset } from '#/lib/planner/closets.ts'
import {
  furnitureNames,
  runLabelBoxes,
  wallLabels,
} from '#/lib/planner/dimensions.ts'
import {
  planWallPath,
  sharedSpansOf,
  wallGaps,
  wallPath,
} from '#/lib/planner/walls.ts'
import {
  SNAP_REACH_PX,
  alignTo,
  alignWall,
  snapTargets,
  wallAxis,
} from '#/lib/planner/snapping.ts'
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
  openingInWall,
  pointOnWall,
  openingWall,
  projectT,
  runWallAt,
  wallAt,
} from '#/lib/planner/openings.ts'
import {
  loopsBack,
  distance,
  furnitureCorners,
  pointInPolygon,
  polygonCentroid,
  polygonBounds,
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
  WallRun,
  Viewport,
} from '#/lib/planner/types.ts'
import { isPointerTool } from '#/lib/planner/types.ts'
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
 * How far, in screen pixels, the pointer must travel before a press on
 * something becomes a drag of it. Under that it is only a click: selecting a
 * thing should never nudge it, and a mouse rarely stays perfectly still
 * between the button going down and coming back up.
 */
const DRAG_SLOP_PX = 4

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
  walls: Array<WallRun>,
  enclosures: Array<Enclosure>,
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
  if (nearestWall(walls, world, reach)) return null
  const enclosure = enclosureAt(enclosures, world)
  return enclosure ? { type: 'enclosure', id: enclosure.key } : null
}

/**
 * Where the name being typed over is written on the plan, and what it says as
 * it stands: over a room's own label, or in the middle of a piece of
 * furniture, which carries no label but is named all the same.
 *
 * Null once whatever was being renamed has gone from under the field.
 */
function editedName(
  walls: Array<WallRun>,
  enclosures: Array<Enclosure>,
  furniture: Array<Furniture>,
  renaming: Rename,
  viewport: Viewport,
): { key: string; at: Point; name: string } | null {
  if (!renaming) return null
  const key = `${renaming.type}:${renaming.id}`
  if (renaming.type === 'enclosure') {
    const enclosure = enclosures.find((found) => found.key === renaming.id)
    if (!enclosure) return null
    const at = worldToScreen(enclosure.centre, viewport)
    return {
      key,
      at: { x: at.x, y: at.y - NAME_LIFT },
      // An empty field rather than the placeholder, so the first thing typed
      // into a space nobody has named is the name, not an edit of the words
      // standing in for one.
      name: enclosure.space?.name ?? '',
    }
  }
  if (renaming.type === 'run') {
    const run = walls.find((r) => r.id === renaming.id)
    if (!run) return null
    const at = worldToScreen(polygonCentroid(run.points), viewport)
    return { key, at: { x: at.x, y: at.y - NAME_LIFT }, name: run.name }
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
  | { mode: 'move-enclosure'; grab: Point; group: EnclosureGroup }
  | { mode: 'move-closet'; id: string; grabT: number }
  | { mode: 'resize'; id: string; handle: Handle }
  | { mode: 'rotate'; id: string; origin: Furniture }
  | { mode: 'vertex'; runId: string; index: number }
  | {
      mode: 'wall'
      detach: boolean
      detached?: boolean
      runId: string
      index: number
      grab: Point
      origin: Array<Point>
    }
  | { mode: 'opening'; id: string }
  | { mode: 'opening-end'; id: string; end: 'start' | 'end' }
  | {
      mode: 'move-underlay'
      grab: Point
      origin: { x: number; y: number }
    }
  | { mode: 'rect' }
  | { mode: 'draw-wall'; started: boolean }

/**
 * The drags the plan goes on measuring through: something being placed, rather
 * than the plan itself being drawn. A room or one of its walls on the move has
 * no clearance to report — it is the thing everything else is measured off —
 * and the snap guides already say what its edges have found, so a drag outside
 * this list puts the selection's clearances away until it is let go of.
 */
const MEASURED: Array<Drag['mode']> = [
  'move-furniture',
  'move-closet',
  'resize',
  'rotate',
  'opening',
  'opening-end',
]

export function Canvas() {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const dragRef = useRef<Drag | null>(null)
  /**
   * Where the pointer went down, and whether it has since travelled far enough
   * for the drag to take. Until it has, a press that was really a click leaves
   * what it landed on exactly where it was.
   */
  const slopRef = useRef<{ start: Point; armed: boolean } | null>(null)
  // Space held turns any drag into a pan. The tracker keeps the key's state
  // itself and clears it when the window loses focus, so a space held on the
  // way out never comes back stuck down.
  const spaceHeld = useKeyHold(EDIT_KEYS.pan)

  const {
    walls,
    spaces,
    furniture: allFurniture,
    showFurniture,
    openings,
    selection,
    renaming,
    brush,
    tool,
    openingKind,
    units,
    viewport,
    draft,
    straightWalls,
    rect: rectDraft,
    size,
  } = useSelector(plannerStore)
  const furniture = showFurniture ? allFurniture : []
  /** All floors are recalculated from the current walls. */
  const enclosures = useMemo(() => enclosuresOf(walls, spaces), [walls, spaces])
  const { underlay, positioning: positioningUnderlay } =
    useSelector(underlayStore)
  const underlayUrl = useBlobUrl(underlay?.blob ?? null)

  const [cursor, setCursor] = useState<Point | null>(null)
  const [drawingSnap, setDrawingSnap] = useState<DrawingSnap | null>(null)
  const drawingGuides = useRef<Array<Guide>>([])
  const [panning, setPanning] = useState(false)
  /** The lines the thing being dragged has locked onto, while it is dragged. */
  const [guides, setGuides] = useState<Array<Guide>>([])
  /** What the drag under way is doing, for the things drawn only during one. */
  const [dragMode, setDragMode] = useState<Drag['mode'] | null>(null)
  /** The wall an opening or closet tool is hovering, and where along it. */
  const [ghost, setGhost] = useState<{
    runId: string
    wall: number
    t: number
  } | null>(null)

  const actions = plannerStore.actions
  const drawnPoints = draftPoints(walls, draft)
  const drawingAnchor = drawnPoints.at(-1)
  const drawCursor =
    cursor && drawingAnchor && straightWalls
      ? straightPoint(drawingAnchor, cursor)
      : cursor

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
      snapTargets(state.walls, exclude),
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

  const settleDrawing = (point: Point): Point => {
    const state = plannerStore.state
    const result = snapDrawingPoint({
      point,
      walls: state.walls,
      anchor: draftPoints(state.walls, state.draft).at(-1),
      straight: state.straightWalls,
      reach: SNAP_REACH_PX / state.viewport.scale,
      step: activeSnapStep(state),
      previous: drawingGuides.current,
    })
    drawingGuides.current = result.guides
    setDrawingSnap(result)
    setGuides(result.guides)
    return result.point
  }

  /**
   * How far a wall being pushed really goes, measured along its own normal:
   * onto a wall line already in the plan if one is within reach, and onto the
   * grid otherwise. A wall square to the page lands on a round coordinate, the
   * way a corner does; one on the diagonal has no coordinate to be round in, so
   * it lands a round distance from where it started instead.
   */
  const settleWall = (frame: Wall, runId: string, across: number): number => {
    const state = plannerStore.state
    const slid = [frame.a, frame.b].map((p) => ({
      x: p.x + frame.normal.x * across,
      y: p.y + frame.normal.y * across,
    }))
    const fit = alignWall(
      slid,
      frame.normal,
      snapTargets(state.walls, runId),
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

  /**
   * Take hold of the pointer for a drag. What it is doing is put up in state as
   * well as in the ref the move handler works from: the ref is what a drag runs
   * on, and the state is what the drawing is rendered from.
   *
   * Where the press landed is kept alongside, so the move handler can hold the
   * drag back until the pointer has actually gone somewhere.
   */
  const begin = (drag: Drag, event: React.PointerEvent) => {
    dragRef.current = drag
    slopRef.current = { start: toScreen(event), armed: false }
    setDragMode(drag.mode)
    capture(event.pointerId)
  }

  // The room tool leaves its guides up between clicks, which is what makes them
  // useful while a polygon is being traced. Putting the tool down clears them.
  useEffect(() => {
    setGuides([])
    setDrawingSnap(null)
    drawingGuides.current = []
  }, [tool, drawingAnchor?.x, drawingAnchor?.y, straightWalls])

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
   * Escape backs out of whatever reaches furthest in: the brush in hand
   * first, then the draft, then the rectangle, then the tool, and only then
   * the selection.
   */
  const cancel = () => {
    if (underlayStore.state.positioning) {
      underlayStore.actions.setPositioning(false)
      return
    }
    const state = plannerStore.state
    if (state.brush) actions.dropStyle()
    else if (state.draft) actions.cancelDraft()
    else if (state.rect) actions.cancelRect()
    else if (!isPointerTool(state.tool)) actions.putToolDown()
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
        options: { enabled: selection !== null && selection.type !== 'wall' },
      },
      { hotkey: EDIT_KEYS.paste, callback: () => actions.paste() },
      // Taken whether or not it does anything, so that the plan never answers a
      // duplicate with the browser's bookmark dialogue.
      {
        hotkey: EDIT_KEYS.duplicate,
        callback: () => actions.duplicateSelection(),
      },
      { hotkey: EDIT_KEYS.cancel, callback: cancel },
      // Putting the pen down always keeps the walls already drawn.
      {
        hotkey: EDIT_KEYS.commit,
        callback: () => actions.cancelDraft(),
        options: { enabled: draft !== null },
      },
      {
        hotkey: EDIT_KEYS.commit,
        callback: () => underlayStore.actions.setPositioning(false),
        options: {
          enabled: positioningUnderlay,
          conflictBehavior: 'allow',
        },
      },
      // A draft gives up its last corner before the plan gives up anything.
      ...[EDIT_KEYS.remove, EDIT_KEYS.removeAlt].map((hotkey) => ({
        hotkey,
        callback: () => {
          if (plannerStore.state.draft) {
            actions.popDraftPoint()
            return
          }
          // A wall that cannot go has a reason, and the key has no panel to
          // print it in. Everything else deleted goes without argument.
          const held = plannerStore.state.selection
          if (held?.type !== 'wall') {
            actions.deleteSelected()
            return
          }
          const result = actions.removeWall(held.id, held.index)
          if (!result.ok)
            toast.error(formatMeasurementMessage(result.error, units))
        },
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
          options: { enabled: selection !== null && selection.type !== 'wall' },
        },
        {
          hotkey: shifted,
          callback: () => nudge(delta, NUDGE_COARSE),
          options: { enabled: selection !== null && selection.type !== 'wall' },
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
    setPanning(true)
    begin(
      {
        mode: 'pan',
        startScreen: toScreen(event),
        startTx: vp.tx,
        startTy: vp.ty,
        moved: false,
      },
      event,
    )
  }

  function onCanvasPointerDown(event: React.PointerEvent) {
    const state = plannerStore.state
    const background = underlayStore.state
    if (background.positioning) {
      if (event.button === 1 || spaceHeld) {
        beginPan(event)
      } else if (event.button === 0 && background.underlay) {
        begin(
          {
            mode: 'move-underlay',
            grab: toWorld(event),
            origin: {
              x: background.underlay.x,
              y: background.underlay.y,
            },
          },
          event,
        )
      }
      return
    }
    if (event.button === 1 || spaceHeld || isPointerTool(state.tool)) {
      beginPan(event)
      return
    }
    if (event.button !== 0) return

    // Wall tools: the click lands on whichever wall the ghost has found.
    if (state.tool === 'opening' || state.tool === 'closet') {
      const eligibleRuns =
        state.tool === 'closet'
          ? state.walls.filter((run) => run.kind !== 'closet')
          : state.walls
      const spot = nearestWall(
        eligibleRuns,
        toWorld(event),
        WALL_REACH_PX / state.viewport.scale,
      )
      if (spot) {
        const t = snapAlong(spot.runId, spot.wall, spot.t)
        if (state.tool === 'closet') {
          actions.addCloset(spot.runId, spot.wall, t)
        } else {
          actions.addOpening(state.openingKind, spot.runId, spot.wall, t)
        }
        setGhost(null)
      }
      return
    }

    // Rectangle tool: drag out the two opposite corners in one gesture.
    if (state.tool === 'rect') {
      actions.beginRect(settle(toWorld(event)))
      begin({ mode: 'rect' }, event)
      return
    }

    // A tap places an endpoint; a drag can draw the first wall in one gesture.
    const started = draftPoints(state.walls, state.draft).length === 0
    if (started) {
      const end = nearestOpenEnd(
        state.walls,
        toWorld(event),
        CLOSE_PX / state.viewport.scale,
      )
      if (end) actions.continueWalls(end.runId, end.end)
      else actions.addDraftPoint(settleDrawing(toWorld(event)))
    }
    setCursor(settleDrawing(toWorld(event)))
    begin({ mode: 'draw-wall', started }, event)
  }

  function placeWall(event: { clientX: number; clientY: number }) {
    const state = plannerStore.state
    const points = draftPoints(state.walls, state.draft)
    if (!points.length) return
    const point = settleDrawing(toWorld(event))
    if (
      points.length >= 3 &&
      closingIssue(points, state.straightWalls) === null &&
      distance(point, points[0]) <= CLOSE_PX / state.viewport.scale
    ) {
      const result = actions.commitDraft()
      if (!result.ok) toast.error(formatMeasurementMessage(result.error, units))
      return
    }
    setCursor(point)
    const result = actions.addDraftPoint(
      state.straightWalls
        ? straightPoint(points[points.length - 1], point)
        : point,
    )
    if (!result.ok) toast.error(formatMeasurementMessage(result.error, units))
  }

  /**
   * Where along a wall a fraction lands once the snap step has had its say.
   * An opening slides along one line, so the step is applied to the distance
   * from the wall's first corner rather than to a point on the grid.
   */
  function snapAlong(runId: string, wall: number, t: number): number {
    const state = plannerStore.state
    const run = state.walls.find((r) => r.id === runId)
    const frame = run && runWallAt(run, wall)
    const step = activeSnapStep(state)
    if (!frame || step === null) return t
    return snapValue(t * frame.length, step) / frame.length
  }

  function onPointerMove(event: React.PointerEvent) {
    const state = plannerStore.state
    if (state.tool === 'run') setCursor(settleDrawing(toWorld(event)))
    if (state.tool === 'opening' || state.tool === 'closet') {
      const eligibleRuns =
        state.tool === 'closet'
          ? state.walls.filter((run) => run.kind !== 'closet')
          : state.walls
      const spot = nearestWall(
        eligibleRuns,
        toWorld(event),
        WALL_REACH_PX / state.viewport.scale,
      )
      setGhost(
        spot && {
          ...spot,
          t: snapAlong(spot.runId, spot.wall, spot.t),
        },
      )
    }

    const drag = dragRef.current
    if (!drag) return

    // A press only becomes a drag once the pointer has left the few pixels it
    // went down in. Panning and the rectangle tool keep their own reckoning:
    // neither can disturb something by starting early.
    const slop = slopRef.current
    if (slop && !slop.armed && drag.mode !== 'pan' && drag.mode !== 'rect') {
      const at = toScreen(event)
      if (distance(at, slop.start) <= DRAG_SLOP_PX) return
      slop.armed = true
    }

    const world = toWorld(event)

    switch (drag.mode) {
      case 'move-enclosure': {
        const dx = world.x - drag.grab.x
        const dy = world.y - drag.grab.y
        const points = drag.group.walls.flatMap((run) => run.points)
        const ids = new Set(drag.group.walls.map((run) => run.id))
        const fit = alignTo(
          translatePolygon(points, dx, dy),
          snapTargets(state.walls.filter((run) => !ids.has(run.id))),
          SNAP_REACH_PX / state.viewport.scale,
        )
        setGuides(fit.guides)
        const bounds = polygonBounds(points)
        const grid = snapPoint(
          { x: bounds.x + dx, y: bounds.y + dy },
          activeSnapStep(state),
        )
        actions.moveEnclosure(
          drag.group,
          fit.dx === null ? grid.x - bounds.x : dx + fit.dx,
          fit.dy === null ? grid.y - bounds.y : dy + fit.dy,
        )
        break
      }
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
        actions.previewFurnitureMove(drag.id, x, y)
        break
      }
      case 'move-closet': {
        const closet = state.walls.find((run) => run.id === drag.id)
        const attachment = closet?.attachment
        const host =
          attachment && state.walls.find((run) => run.id === attachment.runId)
        const wall = host && runWallAt(host, attachment.wall)
        if (!attachment || !wall) break
        actions.updateCloset(drag.id, {
          t: snapAlong(
            attachment.runId,
            attachment.wall,
            projectT(wall, world) - drag.grabT,
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
          actions.previewFurnitureRotation(
            drag.id,
            rotationFor(item, world, state.snap || event.shiftKey),
          )
        }
        break
      }
      case 'vertex': {
        actions.moveVertex(drag.runId, drag.index, settle(world, drag.runId))
        break
      }
      case 'wall': {
        // The wall's frame comes from where it stood when the drag began, so
        // the way it travels cannot drift as it goes, and the outline is built
        // afresh from that same starting shape each frame rather than pushed
        // again and again from wherever the last frame left it.
        const frame = wallAt(drag.origin, drag.index)
        if (!frame) break
        if (drag.detach) {
          const start = snapPoint(
            {
              x: frame.a.x + world.x - drag.grab.x,
              y: frame.a.y + world.y - drag.grab.y,
            },
            activeSnapStep(state),
          )
          if (
            actions.translateWall(
              drag.runId,
              drag.detached ? 0 : drag.index,
              start,
            )
          )
            drag.detached = true
          break
        }
        const across =
          (world.x - drag.grab.x) * frame.normal.x +
          (world.y - drag.grab.y) * frame.normal.y
        actions.moveWall(
          drag.runId,
          drag.index,
          slideWall(
            drag.origin,
            drag.index,
            settleWall(frame, drag.runId, across),
          ),
        )
        break
      }
      case 'opening': {
        const opening = state.openings.find((o) => o.id === drag.id)
        const wall = opening && openingWall(state.walls, opening)
        if (!opening || !wall) break
        actions.updateOpening(drag.id, {
          t: snapAlong(opening.runId, opening.wall, projectT(wall, world)),
        })
        break
      }
      case 'opening-end': {
        // One jamb follows the pointer and the other stays where it is, so the
        // width and the centre both come out of where the two now stand.
        const opening = state.openings.find((o) => o.id === drag.id)
        const wall = opening && openingWall(state.walls, opening)
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
      case 'move-underlay': {
        underlayStore.actions.previewPosition(
          drag.origin.x + world.x - drag.grab.x,
          drag.origin.y + world.y - drag.grab.y,
        )
        break
      }
      case 'rect': {
        actions.updateRect(settle(world))
        break
      }
      case 'draw-wall':
        break
    }
  }

  function onPointerUp(event: React.PointerEvent) {
    const drag = dragRef.current
    if (
      drag?.mode === 'draw-wall' &&
      event.type !== 'pointercancel' &&
      (!drag.started || slopRef.current?.armed)
    ) {
      placeWall(event)
    }
    // A pan that never moved was really just a click on empty space.
    if (drag?.mode === 'pan' && !drag.moved && !spaceHeld) {
      actions.select(null)
    }
    if (drag?.mode === 'rect') actions.commitRect()
    if (drag?.mode === 'move-underlay') {
      underlayStore.actions.commitPosition()
    }
    if (drag?.mode === 'move-furniture' && slopRef.current?.armed) {
      actions.finishFurnitureTransform(drag.id, drag.origin)
    }
    if (drag?.mode === 'rotate' && slopRef.current?.armed) {
      actions.finishFurnitureTransform(drag.id, drag.origin)
    }
    if (drag) actions.sealHistory()
    dragRef.current = null
    slopRef.current = null
    setDragMode(null)
    setPanning(false)
    if (plannerStore.state.tool !== 'run') setGuides([])
    if (svgRef.current?.hasPointerCapture(event.pointerId)) {
      svgRef.current.releasePointerCapture(event.pointerId)
    }
  }

  /**
   * Everything a double-click does: stopping a run of walls; breaking
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
    if (underlayStore.state.positioning) return
    const state = plannerStore.state
    if (state.tool === 'run' && state.draft) {
      actions.cancelDraft()
      return
    }
    if (!isPointerTool(state.tool)) return
    // Two quick strokes of the brush over the same item are two strokes, not
    // an invitation to rename it.
    if (state.brush) return
    const world = toWorld(event)

    const run =
      state.selection?.type === 'run' || state.selection?.type === 'wall'
        ? state.walls.find((r) => r.id === state.selection?.id)
        : undefined
    const spot =
      run && nearestWall([run], world, WALL_GRAB / 2 / state.viewport.scale)
    const frame = run && spot && runWallAt(run, spot.wall)
    // Breaking a wall to add a corner reshapes the room, so it belongs to the
    // edit tool. Under move the click falls through to the rename below, which
    // is what a double click on a room means when its shape is off limits.
    if (
      state.tool === 'edit' &&
      run?.kind !== 'closet' &&
      !run?.locked &&
      spot &&
      frame
    ) {
      actions.insertVertex(
        run.id,
        spot.wall,
        settle(pointOnWall(frame, spot.t), run.id),
      )
      actions.sealHistory()
      // `settle` puts up the guides a drag would want; there is no drag here.
      setGuides([])
      return
    }

    const target = nameableAt(
      state.walls,
      enclosuresOf(state.walls, state.spaces),
      state.showFurniture ? state.furniture : [],
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
    if (target.type === 'run') actions.updateRun(target.id, { name })
    else if (target.type === 'enclosure')
      actions.updateEnclosure(target.id, { name })
    else actions.updateFurniture(target.id, { name })
    // A rename is one step to undo, and the next one starts a step of its own.
    actions.sealHistory()
    actions.endRename()
  }

  function onFurniturePointerDown(item: Furniture, event: React.PointerEvent) {
    if (event.button === 1 || spaceHeld) return beginPan(event)
    if (event.button !== 0) return
    event.stopPropagation()
    // With the brush in hand a click paints what it lands on and stops there:
    // it neither selects the item nor takes hold of it, so the panel goes on
    // showing the one the colour came from and a slip of the hand cannot drag
    // something across the plan mid-brushful.
    if (plannerStore.state.brush) {
      actions.paintFurniture(item.id)
      return
    }
    actions.select({ type: 'furniture', id: item.id })
    begin(
      {
        mode: 'move-furniture',
        id: item.id,
        grab: toWorld(event),
        origin: item,
      },
      event,
    )
  }

  function onResizeHandleDown(handle: Handle, event: React.PointerEvent) {
    event.stopPropagation()
    const current = plannerStore.state.selection
    if (current?.type !== 'furniture') return
    begin({ mode: 'resize', id: current.id, handle }, event)
  }

  function onRotateHandleDown(event: React.PointerEvent) {
    event.stopPropagation()
    const current = plannerStore.state.selection
    if (current?.type !== 'furniture') return
    const item = plannerStore.state.furniture.find((f) => f.id === current.id)
    if (!item) return
    begin({ mode: 'rotate', id: current.id, origin: item }, event)
  }

  function onOpeningPointerDown(opening: Opening, event: React.PointerEvent) {
    if (event.button === 1 || spaceHeld) return beginPan(event)
    if (event.button !== 0) return
    event.stopPropagation()
    actions.select({ type: 'opening', id: opening.id })
    begin({ mode: 'opening', id: opening.id }, event)
  }

  function onOpeningEndDown(end: 'start' | 'end', event: React.PointerEvent) {
    event.stopPropagation()
    const current = plannerStore.state.selection
    if (current?.type !== 'opening') return
    begin({ mode: 'opening-end', id: current.id, end }, event)
  }

  function onVertexDown(index: number, event: React.PointerEvent) {
    event.stopPropagation()
    const current = plannerStore.state.selection
    if (current?.type !== 'run' && current?.type !== 'wall') return
    actions.select({ type: 'run', id: current.id })
    begin({ mode: 'vertex', runId: current.id, index }, event)
  }

  /** Take hold of a whole side of the selected room, to push it across. */
  function onWallDown(index: number, event: React.PointerEvent) {
    if (event.button === 1 || spaceHeld) return beginPan(event)
    if (event.button !== 0) return
    event.stopPropagation()
    const current = plannerStore.state.selection
    if (current?.type !== 'run' && current?.type !== 'wall') return
    const run = plannerStore.state.walls.find((r) => r.id === current.id)
    if (!run) return
    actions.select({ type: 'wall', id: current.id, index })
    begin(
      {
        mode: 'wall',
        detach: plannerStore.state.tool === 'move',
        runId: current.id,
        index,
        grab: toWorld(event),
        origin: run.points,
      },
      event,
    )
  }

  const selectedRun =
    selection?.type === 'run' || selection?.type === 'wall'
      ? walls.find((r) => r.id === selection.id)
      : undefined
  const selectedFurniture =
    selection?.type === 'furniture'
      ? furniture.find((f) => f.id === selection.id)
      : undefined
  // Every opening paired with the wall it is drawn along; one whose wall has
  // gone — a room mid-edit — simply drops out of the drawing.
  const placed = openings.flatMap((opening) => {
    const wall = openingWall(walls, opening)
    return wall ? [{ opening, wall }] : []
  })
  const selectedOpening =
    selection?.type === 'opening'
      ? placed.find(({ opening }) => opening.id === selection.id)
      : undefined

  const ghostWall =
    tool === 'opening' &&
    ghost &&
    wallAt(walls.find((r) => r.id === ghost.runId)?.points ?? [], ghost.wall)

  const closetHost =
    tool === 'closet' && ghost
      ? walls.find((run) => run.id === ghost.runId)
      : undefined
  const closetHostWall =
    closetHost && ghost ? runWallAt(closetHost, ghost.wall) : null
  const closetGhostPlacement =
    closetHostWall && ghost
      ? placeCloset(
          closetHostWall,
          {
            runId: ghost.runId,
            wall: ghost.wall,
            t: ghost.t,
          },
          DEFAULT_CLOSET.width,
          DEFAULT_CLOSET.depth,
        )
      : null
  const closetGhostRun: WallRun | null = closetGhostPlacement
    ? {
        id: 'closet-ghost',
        kind: 'closet',
        name: 'Closet',
        points: closetGhostPlacement.points,
        attachment: closetGhostPlacement.attachment,
      }
    : null
  const closetGhostWall = closetGhostRun && runWallAt(closetGhostRun, 0)
  const closetGhostOpening: Opening | null = closetGhostWall
    ? openingInWall(closetGhostWall, {
        id: 'closet-opening-ghost',
        kind: 'sliding-door',
        runId: 'closet-ghost',
        wall: 0,
        t: 0.5,
      })
    : null
  const openingGhost =
    tool === 'opening' && ghost && ghostWall
      ? openingInWall(ghostWall, {
          id: 'opening-ghost',
          kind: openingKind,
          runId: ghost.runId,
          wall: ghost.wall,
          t: ghost.t,
        })
      : null

  const nearFirst =
    drawnPoints.length >= 3 &&
    closingIssue(drawnPoints, straightWalls) === null &&
    !!drawCursor &&
    distance(
      worldToScreen(drawCursor, viewport),
      worldToScreen(drawnPoints[0], viewport),
    ) <= CLOSE_PX

  // One layout, shared: the wall dimensions are drawn from it, and the
  // selection's own readout reads it to keep out of their way.
  const dimensions = wallLabels(
    walls,
    furniture,
    openings,
    viewport,
    units,
    size,
    enclosures,
  )

  // Where each item's own name is written across it, which is worked out the
  // same way and against the same room labels.
  const names = furnitureNames(walls, furniture, viewport, units, enclosures)

  // Everything already written on the plan by the time a selection's own
  // readout looks for somewhere to sit. The order is what settles a clash: the
  // names take their places, the dimensions work around the footprints they sit
  // in, and the readout — the one label the selection brought with it — gives
  // way to both.
  const written = [
    ...names.map((label) => label.box),
    ...dimensions.map((label) => label.box),
  ]

  // How much room is left around whatever is selected, worked out afresh on
  // every render so that it follows a drag frame by frame. Selecting something
  // is already asking where it sits, so the numbers stand as long as it is
  // held — it is letting go of the selection, not of the drag, that puts them
  // away. Only a drag that redraws the plan itself takes them down meanwhile.
  // Their numbers go beside everything the plan already says, the room labels
  // among them: they are the last thing laid out, so they are the ones that
  // give way.
  const clearances =
    !dragMode || MEASURED.includes(dragMode)
      ? clearancesFor(selection, walls, furniture, openings)
      : []
  const spoken =
    clearances.length === 0
      ? written
      : [...written, ...runLabelBoxes(walls, viewport, units, enclosures)]

  // Every room's walls, with the openings of any room sharing them already cut
  // through. Recomputed each render, as the dimensions are: the plans this
  // holds are a handful of rooms, and walls that lagged a drag by a frame would
  // read as the rooms coming apart.
  const wallDrawing = planWallPath(walls, openings)

  // Where the name being typed over stands on the page, if one is: read on
  // every render, so the field rides along with a pan or a zoom.
  const rename = editedName(walls, enclosures, furniture, renaming, viewport)

  const cursorClass = panning
    ? 'cursor-grabbing'
    : positioningUnderlay
      ? 'cursor-move'
      : brush
        ? 'cursor-copy'
        : isPointerTool(tool)
          ? 'cursor-default'
          : 'cursor-crosshair'

  return (
    <svg
      ref={svgRef}
      width="100%"
      height="100%"
      className={`block touch-none font-mono select-none ${cursorClass}`}
      onPointerDown={onCanvasPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => {
        setCursor(null)
        setDrawingSnap(null)
        drawingGuides.current = []
        setGhost(null)
        setGuides([])
      }}
      onDoubleClick={onDoubleClick}
    >
      <Grid viewport={viewport} units={units} />

      <g
        transform={`translate(${viewport.tx} ${viewport.ty}) scale(${viewport.scale})`}
        className={
          positioningUnderlay || !isPointerTool(tool)
            ? 'pointer-events-none'
            : undefined
        }
      >
        {underlay && underlayUrl && (
          <UnderlayImage
            underlay={underlay}
            href={underlayUrl}
            positioning={positioningUnderlay}
            scale={viewport.scale}
          />
        )}
        {/*
          Floors first, all of them, and the walls afterwards in one pass over
          the lot. A wall belongs to the plan rather than to a room — the one
          between two rooms is a single wall — so it must never be painted over
          by a neighbour's floor, which is what drawing each room whole in turn
          would do.
        */}
        {enclosures.map((enclosure) => {
          const group = enclosureGroup(walls, enclosures, enclosure)
          const movable = !group.walls.some((run) => run.locked)
          return (
            <EnclosureFloor
              key={enclosure.key}
              enclosure={enclosure}
              movable={movable}
              moving={dragMode === 'move-enclosure'}
              selected={
                selection?.type === 'enclosure' &&
                selection.id === enclosure.key
              }
              onPointerDown={(event) => {
                if (event.button === 1 || spaceHeld) return beginPan(event)
                if (event.button !== 0) return
                event.stopPropagation()
                actions.select({ type: 'enclosure', id: enclosure.key })
                if (movable)
                  begin(
                    { mode: 'move-enclosure', grab: toWorld(event), group },
                    event,
                  )
              }}
            />
          )
        })}
        {walls.map((run) => (
          <path
            key={`open-${run.id}`}
            data-open-walls={run.id}
            d={wallPath(walls, openings, run)}
            fill="none"
            stroke="transparent"
            strokeWidth={WALL_GRAB / viewport.scale}
            onPointerDown={(event) => {
              if (event.button !== 0 || spaceHeld) return
              event.stopPropagation()
              if (run.kind === 'closet' && run.attachment) {
                actions.select({ type: 'run', id: run.id })
                const host = walls.find(
                  (candidate) => candidate.id === run.attachment?.runId,
                )
                const frame = host && runWallAt(host, run.attachment.wall)
                if (frame && !run.locked)
                  begin(
                    {
                      mode: 'move-closet',
                      id: run.id,
                      grabT: projectT(frame, toWorld(event)) - run.attachment.t,
                    },
                    event,
                  )
                return
              }
              const spot = nearestWall(
                [run],
                toWorld(event),
                WALL_GRAB / viewport.scale,
              )
              if (spot)
                actions.select({
                  type: 'wall',
                  id: run.id,
                  index: spot.wall,
                })
            }}
          />
        ))}
        {closetGhostRun && (
          <polygon
            points={closetGhostRun.points
              .map((point) => `${point.x},${point.y}`)
              .join(' ')}
            className="fill-muted opacity-50"
          />
        )}
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
            selected={
              selection?.type === 'furniture' && item.id === selection.id
            }
            onPointerDown={(event) => onFurniturePointerDown(item, event)}
          />
        ))}
        {/*
          The walls go down over the furniture too. The band's inner face is
          where a room really stops, so a sofa shoved against a wall wants
          trimming by it rather than sitting on top of it.
        */}
        <g className="pointer-events-none">
          <RunWalls d={wallDrawing} scale={viewport.scale} />
          {closetGhostRun && closetGhostOpening && (
            <g className="opacity-40">
              <RunWalls
                d={wallPath(
                  [...walls, closetGhostRun],
                  [closetGhostOpening],
                  closetGhostRun,
                )}
                scale={viewport.scale}
              />
            </g>
          )}
          {selectedRun && (
            <SharedWalls
              run={selectedRun}
              spans={sharedSpansOf(walls, openings, selectedRun.id)}
              scale={viewport.scale}
            />
          )}
          {/*
            Over the shared-wall marks, so that on a wall which is both, what
            the pointer has hold of is what shows.
          */}
          {selectedRun && selection?.type === 'wall' && (
            <SelectedWall
              run={selectedRun}
              index={selection.index}
              gaps={wallGaps(walls, openings, selectedRun.id, selection.index)}
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
              selected={
                selection?.type === 'opening' && opening.id === selection.id
              }
            />
          ))}
          {openingGhost && ghostWall && (
            <OpeningShape ghost wall={ghostWall} opening={openingGhost} />
          )}
          {closetGhostOpening && closetGhostWall && (
            <OpeningShape
              ghost
              wall={closetGhostWall}
              opening={closetGhostOpening}
            />
          )}
        </g>
      </g>

      <EnclosureLabels
        enclosures={enclosures}
        viewport={viewport}
        units={units}
        renaming={renaming?.type === 'enclosure' ? renaming.id : undefined}
      />
      <FurnitureLabels
        labels={names}
        renaming={renaming?.type === 'furniture' ? renaming.id : undefined}
      />
      <WallDimensions
        labels={dimensions}
        selected={
          selection?.type === 'wall'
            ? { runId: selection.id, wall: selection.index }
            : undefined
        }
        onSelect={
          isPointerTool(tool) && !positioningUnderlay
            ? (runId, wall) => {
                const run = plannerStore.state.walls.find(
                  (candidate) => candidate.id === runId,
                )
                // A single wall is a thing to push under either pointer
                // tool, so the dimension picks out the wall it measures. A
                // closet's walls are never its own, and the click takes the
                // closet instead.
                actions.select(
                  run?.kind === 'closet'
                    ? { type: 'run', id: runId }
                    : { type: 'wall', id: runId, index: wall },
                )
              }
            : undefined
        }
      />
      <SnapGuides guides={guides} viewport={viewport} />
      {tool === 'run' && cursor && drawingSnap?.label && !nearFirst && (
        <g className="pointer-events-none" aria-label={drawingSnap.label}>
          <rect
            x={worldToScreen(drawingSnap.point, viewport).x - 4}
            y={worldToScreen(drawingSnap.point, viewport).y - 4}
            width={8}
            height={8}
            className="fill-background stroke-snap"
            strokeWidth={1.5}
          />
          <text
            x={worldToScreen(drawingSnap.point, viewport).x + 12}
            y={worldToScreen(drawingSnap.point, viewport).y + 16}
            className="fill-foreground stroke-background text-[10px]"
            strokeWidth={3}
            strokeLinejoin="round"
            paintOrder="stroke"
          >
            {drawingSnap.label}
          </text>
        </g>
      )}
      <Clearances
        clearances={clearances}
        viewport={viewport}
        units={units}
        avoid={spoken}
      />

      {/*
        Pushing a wall is how a room is moved a side at a time, so the bands
        are handed to both pointer tools. The corners and the rotate handle
        change the room's shape rather than where it stands, so they stay with
        the edit tool and are simply not passed under move.
      */}
      {isPointerTool(tool) &&
        selectedRun?.kind !== 'closet' &&
        !selectedRun?.locked &&
        selectedRun && (
          <RunEditor
            run={selectedRun}
            gaps={selectedRun.points.map((_, i) =>
              wallGaps(walls, openings, selectedRun.id, i),
            )}
            viewport={viewport}
            selectedWall={
              selection?.type === 'wall' ? selection.index : undefined
            }
            onVertexDown={tool === 'edit' ? onVertexDown : undefined}
            onWallDown={onWallDown}
          />
        )}
      {/*
        The box and the readout say what is selected and how big it is, which
        is worth knowing under either tool. The handles that would change it
        are only handed over to the edit tool.
      */}
      {isPointerTool(tool) && selectedFurniture && (
        <FurnitureEditor
          item={selectedFurniture}
          viewport={viewport}
          units={units}
          avoid={written}
          onHandleDown={tool === 'edit' ? onResizeHandleDown : undefined}
          onRotateDown={tool === 'edit' ? onRotateHandleDown : undefined}
        />
      )}
      {isPointerTool(tool) && selectedOpening && (
        <OpeningEditor
          opening={selectedOpening.opening}
          wall={selectedOpening.wall}
          viewport={viewport}
          units={units}
          avoid={written}
          onEndDown={tool === 'edit' ? onOpeningEndDown : undefined}
        />
      )}
      {rectDraft && (
        <RectPreview rect={rectDraft} viewport={viewport} units={units} />
      )}
      {tool === 'run' &&
        !draft &&
        walls
          .filter((run) => !loopsBack(run.points) && !run.locked)
          .flatMap((run) =>
            [run.points[0], run.points[run.points.length - 1]].map(
              (point, index) => {
                const at = worldToScreen(point, viewport)
                return (
                  <circle
                    key={`${run.id}-${index}`}
                    cx={at.x}
                    cy={at.y}
                    r={5}
                    className="pointer-events-none fill-background stroke-foreground"
                    strokeWidth={1.5}
                  />
                )
              },
            ),
          )}
      {tool === 'run' && drawnPoints.length > 0 && (
        <DraftOverlay
          draft={drawnPoints}
          cursor={nearFirst ? drawnPoints[0] : drawCursor}
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
