import { useEffect, useRef, useState } from 'react'
import { useSelector } from '@tanstack/react-store'

import { Grid } from './grid.tsx'
import {
  FurnitureShape,
  OpeningShape,
  OpeningTarget,
  RoomShape,
} from './shapes.tsx'
import {
  DraftOverlay,
  FurnitureEditor,
  OpeningEditor,
  RectPreview,
  RoomEditor,
  RoomLabels,
  WallDimensions,
} from './overlay.tsx'

import { activeSnapStep, plannerStore } from '#/lib/planner/store.ts'
import { wallLabels } from '#/lib/planner/dimensions.ts'
import { OPENING_PRESETS } from '#/lib/planner/presets.ts'
import {
  clampT,
  fittedWidth,
  nearestWall,
  openingEnds,
  openingWall,
  projectT,
  wallAt,
} from '#/lib/planner/openings.ts'
import {
  distance,
  polygonBounds,
  resizeRotated,
  rotationFor,
  screenToWorld,
  snapPoint,
  snapValue,
  translatePolygon,
  worldToScreen,
} from '#/lib/planner/geometry.ts'

import type {
  Furniture,
  Handle,
  Opening,
  Point,
  Room,
} from '#/lib/planner/types.ts'

/** How close, in screen pixels, a click must be to close the polygon. */
const CLOSE_PX = 12
/** How near a wall the pointer must come, in screen pixels, to open it up. */
const WALL_REACH_PX = 44

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
  | { mode: 'opening'; id: string }
  | { mode: 'opening-end'; id: string; end: 'start' | 'end' }
  | { mode: 'rect' }

export function Canvas() {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const spaceRef = useRef(false)

  const {
    rooms,
    furniture,
    openings,
    selection,
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

  const maybeSnap = (p: Point): Point =>
    snapPoint(p, activeSnapStep(plannerStore.state))

  const capture = (pointerId: number) => {
    svgRef.current?.setPointerCapture(pointerId)
  }

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

  useEffect(() => {
    const isTyping = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable)

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return
      const state = plannerStore.state
      const a = plannerStore.actions

      if (event.key === ' ') {
        spaceRef.current = true
        event.preventDefault()
        return
      }
      if (event.key === 'Escape') {
        if (state.draft) a.cancelDraft()
        else if (state.rect) a.cancelRect()
        else if (state.tool !== 'select') a.setTool('select')
        else a.select(null)
        return
      }
      if (event.key === 'Enter') {
        if (state.draft) a.commitDraft()
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        if (state.draft) a.popDraftPoint()
        else a.deleteSelected()
        return
      }
      if (event.key === 'v' || event.key === 'V') return a.setTool('select')
      if (event.key === 'r' || event.key === 'R') return a.setTool('room')
      if (event.key === 'e' || event.key === 'E') return a.setTool('rect')
      if (event.key === 'd' || event.key === 'D') {
        return a.setOpeningTool('door')
      }
      if (event.key === 'w' || event.key === 'W') {
        return a.setOpeningTool('window')
      }
      if (event.key === 'o' || event.key === 'O') {
        return a.setOpeningTool('opening')
      }

      const step = (activeSnapStep(state) ?? 1) * (event.shiftKey ? 10 : 1)
      const nudge: Record<string, [number, number] | undefined> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      }
      const delta = nudge[event.key]
      if (delta && state.selection) {
        event.preventDefault()
        a.nudgeSelection(delta[0], delta[1])
      }
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === ' ') spaceRef.current = false
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

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
    if (event.button === 1 || spaceRef.current || state.tool === 'select') {
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
      actions.beginRect(maybeSnap(toWorld(event)))
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
    actions.addDraftPoint(maybeSnap(toWorld(event)))
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
    if (state.tool === 'room') setCursor(maybeSnap(toWorld(event)))
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
        let points = translatePolygon(
          drag.origin,
          world.x - drag.grab.x,
          world.y - drag.grab.y,
        )
        const step = activeSnapStep(state)
        if (step !== null) {
          const bounds = polygonBounds(points)
          const snapped = snapPoint({ x: bounds.x, y: bounds.y }, step)
          points = translatePolygon(
            points,
            snapped.x - bounds.x,
            snapped.y - bounds.y,
          )
        }
        actions.updateRoom(drag.id, { points })
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
        actions.moveVertex(drag.roomId, drag.index, maybeSnap(world))
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
        actions.updateRect(maybeSnap(world))
        break
      }
    }
  }

  function onPointerUp(event: React.PointerEvent) {
    const drag = dragRef.current
    // A pan that never moved was really just a click on empty space.
    if (drag?.mode === 'pan' && !drag.moved && !spaceRef.current) {
      actions.select(null)
    }
    if (drag?.mode === 'rect') actions.commitRect()
    dragRef.current = null
    setPanning(false)
    if (svgRef.current?.hasPointerCapture(event.pointerId)) {
      svgRef.current.releasePointerCapture(event.pointerId)
    }
  }

  function onDoubleClick() {
    const state = plannerStore.state
    if (state.tool === 'room' && state.draft) {
      // The second click already added a duplicate vertex; drop it and close.
      actions.popDraftPoint()
      actions.commitDraft()
    }
  }

  function onRoomPointerDown(room: Room, event: React.PointerEvent) {
    if (event.button === 1 || spaceRef.current) return beginPan(event)
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
    if (event.button === 1 || spaceRef.current) return beginPan(event)
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
    if (event.button === 1 || spaceRef.current) return beginPan(event)
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

  function onEdgeDown(index: number, event: React.PointerEvent) {
    event.stopPropagation()
    const current = plannerStore.state.selection
    if (current?.type !== 'room') return
    actions.insertVertex(current.id, index, maybeSnap(toWorld(event)))
    dragRef.current = { mode: 'vertex', roomId: current.id, index: index + 1 }
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
      onPointerLeave={() => setGhost(null)}
      onDoubleClick={onDoubleClick}
    >
      <Grid viewport={viewport} units={units} />

      <g
        transform={`translate(${viewport.tx} ${viewport.ty}) scale(${viewport.scale})`}
        className={tool === 'select' ? undefined : 'pointer-events-none'}
      >
        {rooms.map((room) => (
          <RoomShape
            key={room.id}
            room={room}
            openings={openings.filter((o) => o.roomId === room.id)}
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

      <RoomLabels rooms={rooms} viewport={viewport} units={units} />
      <WallDimensions labels={dimensions} />

      {tool === 'select' && selectedRoom && (
        <RoomEditor
          room={selectedRoom}
          viewport={viewport}
          onVertexDown={onVertexDown}
          onEdgeDown={onEdgeDown}
        />
      )}
      {tool === 'select' && selectedFurniture && (
        <FurnitureEditor
          item={selectedFurniture}
          viewport={viewport}
          units={units}
          avoid={dimensions.map((label) => label.box)}
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
          avoid={dimensions.map((label) => label.box)}
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
    </svg>
  )
}
