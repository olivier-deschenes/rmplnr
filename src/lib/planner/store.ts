import { createStore } from '@tanstack/store'

import { DEFAULT_ROOM, FURNITURE_PRESETS } from './presets.ts'
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
import { DEFAULT_SCALE, MIN_SIZE, PlanSchema } from './types.ts'

import type {
  Furniture,
  FurnitureKind,
  Point,
  RectDraft,
  Room,
  Selection,
  Tool,
  Viewport,
} from './types.ts'

export type PlannerState = {
  rooms: Array<Room>
  furniture: Array<Furniture>
  selection: Selection
  tool: Tool
  snap: boolean
  viewport: Viewport
  /** Vertices of the polygon currently being drawn, if any. */
  draft: Array<Point> | null
  /** Corners of the rectangle room currently being dragged out, if any. */
  rect: RectDraft | null
  /** Canvas size in pixels, kept in sync by a ResizeObserver. */
  size: { width: number; height: number }
}

const initialState: PlannerState = {
  rooms: [],
  furniture: [],
  selection: null,
  tool: 'select',
  snap: true,
  viewport: { tx: 0, ty: 0, scale: DEFAULT_SCALE },
  draft: null,
  rect: null,
  size: { width: 0, height: 0 },
}

const newId = () => crypto.randomUUID()

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
    rooms: [...state.rooms, room],
    draft: null,
    rect: null,
    tool: 'select',
    selection: { type: 'room', id: room.id },
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
    const centre = state.snap ? snapPoint(raw) : raw
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
      furniture: [...s.furniture, item],
      selection: { type: 'furniture', id: item.id },
      tool: 'select',
    }))
  },

  updateFurniture(id: string, patch: Partial<Furniture>) {
    setState((s) => ({
      ...s,
      furniture: s.furniture.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    }))
  },

  updateRoom(id: string, patch: Partial<Room>) {
    setState((s) => ({
      ...s,
      rooms: s.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }))
  },

  moveVertex(roomId: string, index: number, point: Point) {
    setState((s) => ({
      ...s,
      rooms: s.rooms.map((r) =>
        r.id === roomId
          ? { ...r, points: r.points.map((p, i) => (i === index ? point : p)) }
          : r,
      ),
    }))
  },

  insertVertex(roomId: string, afterIndex: number, point: Point) {
    setState((s) => ({
      ...s,
      rooms: s.rooms.map((r) => {
        if (r.id !== roomId) return r
        const points = [...r.points]
        points.splice(afterIndex + 1, 0, point)
        return { ...r, points }
      }),
    }))
  },

  deleteVertex(roomId: string, index: number) {
    setState((s) => ({
      ...s,
      rooms: s.rooms.map((r) =>
        r.id !== roomId || r.points.length <= 3
          ? r
          : { ...r, points: r.points.filter((_, i) => i !== index) },
      ),
    }))
  },

  deleteSelected() {
    setState((s) => {
      if (!s.selection) return s
      const { type, id } = s.selection
      return {
        ...s,
        rooms: type === 'room' ? s.rooms.filter((r) => r.id !== id) : s.rooms,
        furniture:
          type === 'furniture'
            ? s.furniture.filter((f) => f.id !== id)
            : s.furniture,
        selection: null,
      }
    })
  },

  nudgeSelection(dx: number, dy: number) {
    setState((s) => {
      if (!s.selection) return s
      const { type, id } = s.selection
      if (type === 'room') {
        return {
          ...s,
          rooms: s.rooms.map((r) =>
            r.id === id
              ? { ...r, points: translatePolygon(r.points, dx, dy) }
              : r,
          ),
        }
      }
      return {
        ...s,
        furniture: s.furniture.map((f) =>
          f.id === id ? { ...f, x: f.x + dx, y: f.y + dy } : f,
        ),
      }
    })
  },

  addDraftPoint(point: Point) {
    setState((s) => ({ ...s, draft: [...(s.draft ?? []), point] }))
  },

  popDraftPoint() {
    setState((s) => {
      if (!s.draft) return s
      const draft = s.draft.slice(0, -1)
      return { ...s, draft: draft.length === 0 ? null : draft }
    })
  },

  cancelDraft() {
    setState((s) => ({ ...s, draft: null }))
  },

  /** Close the in-progress polygon into a room. Needs at least 3 vertices. */
  commitDraft() {
    setState((s) => {
      if (!s.draft || s.draft.length < 3) return { ...s, draft: null }
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

  loadPlan(rooms: Array<Room>, furniture: Array<Furniture>) {
    setState((s) => ({ ...s, rooms, furniture, selection: null }))
  },
}))

// --- persistence ------------------------------------------------------------

const STORAGE_KEY = 'rmplnr.plan.v1'

/**
 * Read the saved plan. Returns null when there is nothing stored, or when the
 * stored payload no longer matches the schema, so stale data can never crash
 * the editor. Client-only: call this from an effect.
 */
export function loadStoredPlan(): {
  rooms: Array<Room>
  furniture: Array<Furniture>
} | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = PlanSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) return null
    return { rooms: parsed.data.rooms, furniture: parsed.data.furniture }
  } catch {
    return null
  }
}

/** Persist rooms and furniture on change. Returns an unsubscribe function. */
export function startAutosave(debounceMs = 300): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined

  const subscription = plannerStore.subscribe(() => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      const { rooms, furniture } = plannerStore.state
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ version: 1, rooms, furniture }),
        )
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
