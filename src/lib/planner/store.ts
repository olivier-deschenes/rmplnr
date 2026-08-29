import { createStore } from '@tanstack/store'

import { DEFAULT_ROOM, FURNITURE_PRESETS, OPENING_PRESETS } from './presets.ts'
import {
  clampScale,
  fitViewport,
  planBounds,
  rectPolygon,
  screenToWorld,
  snapPoint,
  translatePolygon,
  zoomAt,
} from './geometry.ts'
import {
  clampT,
  fittedWidth,
  openingWall,
  reattachOpenings,
  wallAt,
} from './openings.ts'
import { EMPTY_HISTORY, pushHistory, snapshotOf } from './history.ts'
import { SNAP_STEP } from './units.ts'
import { DEFAULT_SCALE, MIN_SIZE, PlanSchema, PrefsSchema } from './types.ts'

import type { History, Snapshot } from './history.ts'
import type {
  Furniture,
  FurnitureKind,
  Opening,
  OpeningKind,
  Point,
  Prefs,
  RectDraft,
  Room,
  Selection,
  Tool,
  Units,
  Viewport,
} from './types.ts'

export type PlannerState = {
  rooms: Array<Room>
  furniture: Array<Furniture>
  /** Doors, windows and gaps, each attached to one wall of one room. */
  openings: Array<Opening>
  selection: Selection
  tool: Tool
  /** What the opening tool is about to place. */
  openingKind: OpeningKind
  snap: boolean
  /** Display only: the plan itself is always stored in centimetres. */
  units: Units
  viewport: Viewport
  /** Vertices of the polygon currently being drawn, if any. */
  draft: Array<Point> | null
  /** Corners of the rectangle room currently being dragged out, if any. */
  rect: RectDraft | null
  /** Canvas size in pixels, kept in sync by a ResizeObserver. */
  size: { width: number; height: number }
  /** Steps taken and steps taken back, for undo and redo. */
  history: History
}

const initialState: PlannerState = {
  rooms: [],
  furniture: [],
  openings: [],
  selection: null,
  tool: 'select',
  openingKind: 'door',
  snap: true,
  units: 'metric',
  viewport: { tx: 0, ty: 0, scale: DEFAULT_SCALE },
  draft: null,
  rect: null,
  size: { width: 0, height: 0 },
  history: EMPTY_HISTORY,
}

const newId = () => crypto.randomUUID()

/**
 * Note where the plan stands before a change, so undo has somewhere to come
 * back to. Changes made under the same label collapse into one step; `null`
 * always starts a step of its own.
 */
function commit(state: PlannerState, label: string | null): History {
  return pushHistory(state.history, state, label)
}

/**
 * A label naming the change a patch makes, rather than the thing it makes it
 * to: a drag sends the same fields frame after frame and folds into one step,
 * while two fields typed into the inspector stay two.
 */
function patchLabel(kind: string, id: string, patch: object): string {
  return `${kind}:${id}:${Object.keys(patch).sort().join(',')}`
}

/**
 * Put a recorded step back in place. Whatever was half-drawn at the time comes
 * back with it, and the tool follows the drawing either way: back into a
 * polygon there is more of to trace, and out of one that has just been put
 * away again, the way finishing a room hands the tool back. A rectangle being
 * dragged out is dropped — it was never a step of its own, and the drag that
 * owned it is long over.
 */
function restore(state: PlannerState, step: Snapshot): PlannerState {
  return {
    ...state,
    ...step,
    rect: null,
    tool: step.draft ? 'room' : state.draft ? 'select' : state.tool,
  }
}

/**
 * The grid step the pointer currently lands on, or null when snapping is off.
 * The step follows the unit system so imperial plans land on whole inches.
 */
export function activeSnapStep(state: PlannerState): number | null {
  return state.snap ? SNAP_STEP[state.units] : null
}

/** Centre of the visible canvas, in world coordinates. */
function viewCentre(state: PlannerState): Point {
  return screenToWorld(
    { x: state.size.width / 2, y: state.size.height / 2 },
    state.viewport,
  )
}

/** Add a finished polygon as a room, select it, and hand the tool back. */
function withRoom(state: PlannerState, points: Array<Point>): PlannerState {
  const room: Room = {
    id: newId(),
    name: `Room ${state.rooms.length + 1}`,
    points,
  }
  return {
    ...state,
    history: commit(state, null),
    rooms: [...state.rooms, room],
    draft: null,
    rect: null,
    tool: 'select',
    selection: { type: 'room', id: room.id },
  }
}

/**
 * Swap in a new corner list for a room. Renumbering the walls would otherwise
 * leave its doors and windows pointing at the wrong ones, so they are read back
 * onto the new outline in the same move.
 */
function reshaped(
  state: PlannerState,
  room: Room,
  points: Array<Point>,
): PlannerState {
  return {
    ...state,
    rooms: state.rooms.map((r) => (r.id === room.id ? { ...r, points } : r)),
    openings: reattachOpenings(state.openings, room.id, room.points, points),
  }
}

export const plannerStore = createStore(initialState, ({ setState, get }) => ({
  setTool(tool: Tool) {
    setState((s) => ({
      ...s,
      tool,
      draft: tool === 'room' ? s.draft : null,
      rect: tool === 'rect' ? s.rect : null,
    }))
  },

  toggleSnap() {
    setState((s) => ({ ...s, snap: !s.snap }))
  },

  setUnits(units: Units) {
    setState((s) => ({ ...s, units }))
  },

  setViewport(viewport: Viewport) {
    setState((s) => ({ ...s, viewport }))
  },

  setSize(width: number, height: number) {
    setState((s) => ({ ...s, size: { width, height } }))
  },

  panBy(dx: number, dy: number) {
    setState((s) => ({
      ...s,
      viewport: {
        ...s.viewport,
        tx: s.viewport.tx + dx,
        ty: s.viewport.ty + dy,
      },
    }))
  },

  zoomAtPoint(anchor: Point, nextScale: number) {
    setState((s) => ({ ...s, viewport: zoomAt(s.viewport, anchor, nextScale) }))
  },

  /** Zoom about the middle of the canvas, for the toolbar buttons. */
  zoomBy(factor: number) {
    setState((s) => {
      const anchor = { x: s.size.width / 2, y: s.size.height / 2 }
      return {
        ...s,
        viewport: zoomAt(
          s.viewport,
          anchor,
          clampScale(s.viewport.scale * factor),
        ),
      }
    })
  },

  fit() {
    setState((s) => {
      const bounds = planBounds(s.rooms, s.furniture)
      if (!bounds || s.size.width === 0) {
        return { ...s, viewport: { tx: 0, ty: 0, scale: DEFAULT_SCALE } }
      }
      return {
        ...s,
        viewport: fitViewport(bounds, s.size.width, s.size.height),
      }
    })
  },

  select(selection: Selection) {
    setState((s) => ({ ...s, selection }))
  },

  addFurniture(kind: FurnitureKind) {
    const state = get()
    const preset = FURNITURE_PRESETS[kind]
    const raw = viewCentre(state)
    const centre = snapPoint(raw, activeSnapStep(state))
    // Cascade off anything already sitting on that spot, so a newly added item
    // is never hidden underneath the last one.
    while (
      state.furniture.some(
        (f) => Math.abs(f.x - centre.x) < 1 && Math.abs(f.y - centre.y) < 1,
      )
    ) {
      centre.x += 20
      centre.y += 20
    }
    const count = state.furniture.filter((f) => f.kind === kind).length + 1
    const item: Furniture = {
      id: newId(),
      kind,
      name: `${preset.label} ${count}`,
      x: centre.x,
      y: centre.y,
      w: preset.w,
      h: preset.h,
      rotation: 0,
    }
    setState((s) => ({
      ...s,
      history: commit(s, null),
      furniture: [...s.furniture, item],
      selection: { type: 'furniture', id: item.id },
      tool: 'select',
    }))
  },

  /** Arm the opening tool with the kind the next click will place. */
  setOpeningTool(kind: OpeningKind) {
    setState((s) => ({
      ...s,
      tool: 'opening',
      openingKind: kind,
      draft: null,
      rect: null,
    }))
  },

  /**
   * Cut an opening into a wall and hand the tool back, the way finishing a room
   * does: the new door lands selected, with its handles up, ready to be sized.
   */
  addOpening(kind: OpeningKind, roomId: string, wall: number, t: number) {
    const state = get()
    const room = state.rooms.find((r) => r.id === roomId)
    const frame = room ? wallAt(room.points, wall) : null
    if (!frame) return
    const width = fittedWidth(OPENING_PRESETS[kind].width, frame.length)
    const opening: Opening = {
      id: newId(),
      kind,
      roomId,
      wall,
      t: clampT(t, width, frame.length),
      width,
      hinge: 'start',
      swing: 'in',
    }
    setState((s) => ({
      ...s,
      history: commit(s, null),
      openings: [...s.openings, opening],
      selection: { type: 'opening', id: opening.id },
      tool: 'select',
    }))
  },

  /**
   * Every route into an opening — a drag, a nudge, a typed width — comes
   * through here, so the wall it sits on gets the last word on how wide it can
   * be and how far along it may go.
   */
  updateOpening(id: string, patch: Partial<Opening>) {
    setState((s) => ({
      ...s,
      history: commit(s, patchLabel('opening', id, patch)),
      openings: s.openings.map((o) => {
        if (o.id !== id) return o
        const next = { ...o, ...patch }
        const wall = openingWall(s.rooms, next)
        if (!wall) return next
        const width = fittedWidth(next.width, wall.length)
        return { ...next, width, t: clampT(next.t, width, wall.length) }
      }),
    }))
  },

  updateFurniture(id: string, patch: Partial<Furniture>) {
    setState((s) => ({
      ...s,
      history: commit(s, patchLabel('furniture', id, patch)),
      furniture: s.furniture.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    }))
  },

  updateRoom(id: string, patch: Partial<Room>) {
    setState((s) => ({
      ...s,
      history: commit(s, patchLabel('room', id, patch)),
      rooms: s.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }))
  },

  moveVertex(roomId: string, index: number, point: Point) {
    setState((s) => ({
      ...s,
      history: commit(s, `vertex:${roomId}:${index}`),
      rooms: s.rooms.map((r) =>
        r.id === roomId
          ? { ...r, points: r.points.map((p, i) => (i === index ? point : p)) }
          : r,
      ),
    }))
  },

  insertVertex(roomId: string, afterIndex: number, point: Point) {
    setState((s) => {
      const room = s.rooms.find((r) => r.id === roomId)
      if (!room) return s
      const points = [...room.points]
      points.splice(afterIndex + 1, 0, point)
      return reshaped({ ...s, history: commit(s, null) }, room, points)
    })
  },

  deleteVertex(roomId: string, index: number) {
    setState((s) => {
      const room = s.rooms.find((r) => r.id === roomId)
      if (!room || room.points.length <= 3) return s
      return reshaped(
        { ...s, history: commit(s, null) },
        room,
        room.points.filter((_, i) => i !== index),
      )
    })
  },

  deleteSelected() {
    setState((s) => {
      if (!s.selection) return s
      const { type, id } = s.selection
      return {
        ...s,
        history: commit(s, null),
        rooms: type === 'room' ? s.rooms.filter((r) => r.id !== id) : s.rooms,
        furniture:
          type === 'furniture'
            ? s.furniture.filter((f) => f.id !== id)
            : s.furniture,
        // A room takes its doors and windows down with it.
        openings: s.openings.filter((o) =>
          type === 'room' ? o.roomId !== id : o.id !== id,
        ),
        selection: null,
      }
    })
  },

  nudgeSelection(dx: number, dy: number) {
    setState((s) => {
      if (!s.selection) return s
      const { type, id } = s.selection
      const history = commit(s, `nudge:${type}:${id}`)
      if (type === 'opening') {
        // An opening has one degree of freedom, so an arrow key is read as how
        // far it pushes the opening along its own wall.
        const opening = s.openings.find((o) => o.id === id)
        const wall = opening && openingWall(s.rooms, opening)
        if (!opening || !wall) return s
        const along = dx * wall.tangent.x + dy * wall.tangent.y
        return {
          ...s,
          history,
          openings: s.openings.map((o) =>
            o.id === id
              ? {
                  ...o,
                  t: clampT(o.t + along / wall.length, o.width, wall.length),
                }
              : o,
          ),
        }
      }
      if (type === 'room') {
        return {
          ...s,
          history,
          rooms: s.rooms.map((r) =>
            r.id === id
              ? { ...r, points: translatePolygon(r.points, dx, dy) }
              : r,
          ),
        }
      }
      return {
        ...s,
        history,
        furniture: s.furniture.map((f) =>
          f.id === id ? { ...f, x: f.x + dx, y: f.y + dy } : f,
        ),
      }
    })
  },

  addDraftPoint(point: Point) {
    setState((s) => ({
      ...s,
      history: commit(s, null),
      draft: [...(s.draft ?? []), point],
    }))
  },

  popDraftPoint() {
    setState((s) => {
      if (!s.draft) return s
      const draft = s.draft.slice(0, -1)
      return {
        ...s,
        history: commit(s, null),
        draft: draft.length === 0 ? null : draft,
      }
    })
  },

  cancelDraft() {
    setState((s) =>
      s.draft === null ? s : { ...s, history: commit(s, null), draft: null },
    )
  },

  /** Close the in-progress polygon into a room. Needs at least 3 vertices. */
  commitDraft() {
    setState((s) => {
      if (!s.draft) return s
      if (s.draft.length < 3) {
        return { ...s, history: commit(s, null), draft: null }
      }
      return withRoom(s, s.draft)
    })
  },

  beginRect(point: Point) {
    setState((s) => ({ ...s, rect: { start: point, end: point } }))
  },

  updateRect(point: Point) {
    setState((s) => (s.rect ? { ...s, rect: { ...s.rect, end: point } } : s))
  },

  /**
   * Turn the dragged-out rectangle into a room. A drag too small to be a room
   * is read as a plain click, which drops a default-sized one on the spot.
   */
  commitRect() {
    setState((s) => {
      if (!s.rect) return s
      const { start, end } = s.rect
      const tooSmall =
        Math.abs(end.x - start.x) < MIN_SIZE ||
        Math.abs(end.y - start.y) < MIN_SIZE
      const corners = tooSmall
        ? rectPolygon(
            {
              x: start.x - DEFAULT_ROOM.w / 2,
              y: start.y - DEFAULT_ROOM.h / 2,
            },
            {
              x: start.x + DEFAULT_ROOM.w / 2,
              y: start.y + DEFAULT_ROOM.h / 2,
            },
          )
        : rectPolygon(start, end)
      return withRoom(s, corners)
    })
  },

  cancelRect() {
    setState((s) => ({ ...s, rect: null }))
  },

  /** Step back to how the plan stood before the last change. */
  undo() {
    setState((s) => {
      const step = s.history.past.at(-1)
      if (!step) return s
      return {
        ...restore(s, step),
        history: {
          past: s.history.past.slice(0, -1),
          future: [...s.history.future, snapshotOf(s)],
          label: null,
        },
      }
    })
  },

  /** Step forward again, as far as the last undo came back from. */
  redo() {
    setState((s) => {
      const step = s.history.future.at(-1)
      if (!step) return s
      return {
        ...restore(s, step),
        history: {
          past: [...s.history.past, snapshotOf(s)],
          future: s.history.future.slice(0, -1),
          label: null,
        },
      }
    })
  },

  /**
   * Close the step being written, so the next change starts one of its own.
   * Called wherever a gesture ends — a pointer released, an arrow key let go,
   * a typed field committed — which is what keeps two drags of the same thing
   * from folding into a single undo.
   */
  sealHistory() {
    setState((s) =>
      s.history.label === null
        ? s
        : { ...s, history: { ...s.history, label: null } },
    )
  },

  loadPlan(
    rooms: Array<Room>,
    furniture: Array<Furniture>,
    openings: Array<Opening>,
  ) {
    setState((s) => ({
      ...s,
      rooms,
      furniture,
      openings,
      selection: null,
      history: EMPTY_HISTORY,
    }))
  },
}))

// --- persistence ------------------------------------------------------------

const STORAGE_KEY = 'rmplnr.plan.v1'
const PREFS_KEY = 'rmplnr.prefs.v1'

/**
 * Read the saved plan. Returns null when there is nothing stored, or when the
 * stored payload no longer matches the schema, so stale data can never crash
 * the editor. Client-only: call this from an effect.
 */
export function loadStoredPlan(): {
  rooms: Array<Room>
  furniture: Array<Furniture>
  openings: Array<Opening>
} | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = PlanSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) return null
    const { rooms, furniture, openings } = parsed.data
    return {
      rooms,
      furniture,
      // An opening whose room or wall is no longer there has nothing to hang
      // on, and would otherwise sit in the plan doing nothing for ever.
      openings: openings.filter((o) => {
        const room = rooms.find((r) => r.id === o.roomId)
        return room !== undefined && o.wall < room.points.length
      }),
    }
  } catch {
    return null
  }
}

/**
 * Read the saved editor preferences, on the same be-forgiving terms as the
 * plan: anything unreadable falls back to the defaults. Client-only.
 */
export function loadStoredPrefs(): Prefs | null {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return null
    const parsed = PrefsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Persist the plan and the preferences on change. Returns an unsubscribe. */
export function startAutosave(debounceMs = 300): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined

  const subscription = plannerStore.subscribe(() => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      const { rooms, furniture, openings, units } = plannerStore.state
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ version: 1, rooms, furniture, openings }),
        )
        localStorage.setItem(PREFS_KEY, JSON.stringify({ version: 1, units }))
      } catch {
        // Storage full or blocked; editing carries on regardless.
      }
    }, debounceMs)
  })

  return () => {
    clearTimeout(timer)
    subscription.unsubscribe()
  }
}
