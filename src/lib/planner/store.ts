import { createStore } from '@tanstack/store'

import { DEFAULT_ROOM, FURNITURE_PRESETS, OPENING_PRESETS } from './presets.ts'
import {
  clampScale,
  fitViewport,
  planBounds,
  rectPolygon,
  screenToWorld,
  snapPoint,
  snapValue,
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
import { blockersFor, fits, settleFurniture } from './collision.ts'
import { EMPTY_HISTORY, pushHistory, snapshotOf } from './history.ts'
import {
  describeFurniture,
  describeOpening,
  describeRoom,
  openingName,
  selectionName,
} from './describe.ts'
import { SNAP_STEP } from './units.ts'
import {
  DEFAULT_SCALE,
  LibrarySchema,
  MIN_SIZE,
  PlanSchema,
  PrefsSchema,
} from './types.ts'

import type { History, Snapshot } from './history.ts'
import type {
  Clipboard,
  Furniture,
  FurnitureKind,
  Library,
  Opening,
  OpeningKind,
  Point,
  Prefs,
  Project,
  RectDraft,
  Rename,
  Room,
  Selection,
  Tool,
  Units,
  Viewport,
} from './types.ts'

export type PlannerState = {
  /**
   * Every plan saved, the open one among them. Its entry here is the copy last
   * written down: the plan actually being drawn on is `rooms`, `furniture` and
   * `openings` below, and is read back into its entry whenever the library as
   * a whole is wanted — which is what `libraryOf` is for.
   */
  projects: Array<Project>
  /**
   * Whether the library has been read back out of the browser yet. Until it
   * has, an empty `projects` means unread rather than empty — which is the
   * difference between a page that says there are no plans and one that has
   * not looked. The server renders on the unread state, so the first render in
   * the browser has to match it.
   */
  restored: boolean
  /**
   * The plan the URL names, and so the one `rooms`, `furniture` and `openings`
   * hold. Null on any page that is not looking at a plan.
   */
  projectId: string | null
  rooms: Array<Room>
  furniture: Array<Furniture>
  /** Doors, windows and gaps, each attached to one wall of one room. */
  openings: Array<Opening>
  selection: Selection
  /** The name currently being typed over on the plan, if any. */
  renaming: Rename
  /** What was last copied, waiting to be put down again. */
  clipboard: Clipboard | null
  tool: Tool
  /** What the opening tool is about to place. */
  openingKind: OpeningKind
  snap: boolean
  /** Whether furniture is held out of the walls and out of each other. */
  collide: boolean
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
  projects: [],
  restored: false,
  projectId: null,
  rooms: [],
  furniture: [],
  openings: [],
  selection: null,
  renaming: null,
  clipboard: null,
  tool: 'select',
  openingKind: 'door',
  snap: true,
  collide: true,
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
 * back to, under the name the history panel lists it by. Changes made under
 * the same label collapse into one step; `null` always starts a step of its
 * own.
 */
function commit(
  state: PlannerState,
  label: string | null,
  text: string,
): History {
  return pushHistory(state.history, state, label, text)
}

/**
 * A label naming the change a patch makes, rather than the thing it makes it
 * to: a drag sends the same fields frame after frame and folds into one step,
 * while two fields typed into the inspector stay two.
 */
/** Whether two outlines stand in the same place, to within rounding. */
function sameOutline(a: Array<Point>, b: Array<Point>): boolean {
  return (
    a.length === b.length &&
    a.every(
      (p, i) => Math.abs(p.x - b[i].x) < 1e-6 && Math.abs(p.y - b[i].y) < 1e-6,
    )
  )
}

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
    renaming: null,
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
    history: commit(state, null, `Added ${room.name}`),
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

/**
 * What the plan puts in one piece of furniture's way, as it now stands. Empty
 * when collision is switched off, which leaves every placement below going
 * through untouched rather than needing a case of its own.
 */
function inTheWayOf(state: PlannerState, exclude?: string) {
  return state.collide
    ? blockersFor(state.rooms, state.furniture, state.openings, exclude)
    : []
}

/** How far apart the spots tried when looking for somewhere to put something. */
const CASCADE = 20

/** How far out that search goes before it gives up and drops it where asked. */
const CASCADE_RINGS = 12

/**
 * Somewhere to put a new piece of furniture, tried nearest first: the spot
 * asked for, then the ring of spots around it, then the ring around that. A
 * new item is meant to land where the eye already is, so a plain cascade off
 * down the diagonal is no good — a crowded corner would send it clean out of
 * the room and off to one side of everything.
 */
const CASCADE_SPOTS: Array<Point> = (() => {
  const spots: Array<Point> = [{ x: 0, y: 0 }]
  for (let ring = 1; ring <= CASCADE_RINGS; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue
        spots.push({ x: dx * CASCADE, y: dy * CASCADE })
      }
    }
  }
  return spots
})()

/**
 * Where a piece of furniture about to be put down actually lands: the spot
 * asked for, or the nearest one out from it that is free, searched no further
 * out than `reach`.
 *
 * A plan with nowhere free within that reach gets it on the spot asked for
 * regardless: an item overlapping something is at least there to be seen and
 * dragged away — and one already lapping is let out of the collision rule
 * until it is somewhere clear, so it can be dragged straight off again.
 */
function freeSpot(
  state: PlannerState,
  shape: Omit<Furniture, 'x' | 'y'>,
  centre: Point,
  reach = CASCADE_RINGS * CASCADE,
): Point {
  const blockers = inTheWayOf(state)
  for (const offset of CASCADE_SPOTS) {
    // The spots come out ring by ring, so the first one beyond the reach is
    // where the search stops.
    if (Math.max(Math.abs(offset.x), Math.abs(offset.y)) > reach) break
    const spot = { x: centre.x + offset.x, y: centre.y + offset.y }
    const taken = state.furniture.some(
      (f) => Math.abs(f.x - spot.x) < 1 && Math.abs(f.y - spot.y) < 1,
    )
    if (!taken && fits({ ...shape, ...spot }, blockers)) return spot
  }
  return centre
}

/** Whether a patch asks a piece of furniture to take up any different floor. */
function displaced(from: Furniture, to: Furniture): boolean {
  return (
    from.x !== to.x ||
    from.y !== to.y ||
    from.w !== to.w ||
    from.h !== to.h ||
    from.rotation !== to.rotation
  )
}

/**
 * Where a piece of furniture asked to stand at `to` actually ends up. Every
 * route into a piece of furniture — a drag, a handle, an arrow key, a typed
 * field — comes through here, so there is one place that decides how near it
 * gets, and nothing can be got into a wall by taking a different way in.
 *
 * A patch that leaves the footprint alone, such as a rename, is not a
 * placement and is not measured against anything.
 */
function placed(
  state: PlannerState,
  from: Furniture,
  to: Furniture,
): Furniture {
  if (!state.collide || !displaced(from, to)) return to
  return settleFurniture(from, to, inTheWayOf(state, from.id))
}

// --- copying ----------------------------------------------------------------

/** A trailing `copy`, with or without a number after it. */
const COPY_SUFFIX = / copy(?: \d+)?$/

/**
 * What to call a copy: the name it was taken from with `copy` after it, and a
 * number after that once the plain one is spoken for. A copy of a copy is
 * another copy of the same original rather than a `Sofa 1 copy copy`, which is
 * what duplicating the same thing twice over would otherwise leave behind.
 */
function copyName(name: string, taken: Array<string>): string {
  const base = `${name.replace(COPY_SUFFIX, '')} copy`
  if (!taken.includes(base)) return base
  // Every candidate is a name of its own, and there are only so many taken, so
  // one of them is free.
  for (let n = 2; ; n++) {
    if (!taken.includes(`${base} ${n}`)) return `${base} ${n}`
  }
}

/**
 * How far a copy stands from what it was copied from: far enough to read as a
 * second thing rather than a thicker line, and near enough to still be part of
 * the same glance.
 */
const PASTE_OFFSET = 20

/**
 * How far a copy may be shifted about to find room to stand in before it is
 * simply put down where it was asked for, lapping whatever is there.
 *
 * A metre, because a copy is made to be seen beside what it came from: a new
 * item has nowhere it belongs yet and can be cascaded clean across the plan to
 * find space, but a copy sent that far has lost the one thing it was for. Room
 * enough for anything to step off its own long side, and short enough that in
 * a crowded room the copy lands under the pointer instead of in the hall.
 */
const PASTE_REACH = 100

/**
 * That offset, rounded to whole grid steps, so a copy of something square to
 * the grid lands square to it too — and an inch grid is not thrown off by a
 * distance measured in centimetres.
 */
function pasteOffset(state: PlannerState): number {
  const step = activeSnapStep(state)
  return step === null ? PASTE_OFFSET : snapValue(PASTE_OFFSET, step)
}

/** What the selection would be copied as, or null when nothing is selected. */
function copyOf(state: PlannerState): Clipboard | null {
  const selection = state.selection
  if (!selection) return null
  if (selection.type === 'room') {
    const room = state.rooms.find((r) => r.id === selection.id)
    // A room is copied with the doors and windows cut into it, the same way it
    // is deleted with them: without those it is an outline rather than a room.
    return room
      ? {
          type: 'room',
          room,
          openings: state.openings.filter((o) => o.roomId === room.id),
        }
      : null
  }
  if (selection.type === 'furniture') {
    const item = state.furniture.find((f) => f.id === selection.id)
    return item ? { type: 'furniture', item } : null
  }
  const opening = state.openings.find((o) => o.id === selection.id)
  return opening ? { type: 'opening', opening } : null
}

/**
 * Put a copy down, selected and with the tool handed back, the way anything
 * else added to the plan arrives: one step to undo, ready to be dragged off
 * the thing it came from.
 *
 * The copy takes the original's place in the clipboard, so that a run of
 * pastes walks across the plan instead of stacking every copy on the same
 * spot.
 */
function pasted(state: PlannerState, clipboard: Clipboard): PlannerState {
  const offset = pasteOffset(state)

  if (clipboard.type === 'room') {
    const room: Room = {
      id: newId(),
      name: copyName(
        clipboard.room.name,
        state.rooms.map((r) => r.name),
      ),
      points: translatePolygon(clipboard.room.points, offset, offset),
    }
    // The openings come across on the same walls of the same outline, so they
    // need nothing but the new room to belong to.
    const openings = clipboard.openings.map((o) => ({
      ...o,
      id: newId(),
      roomId: room.id,
    }))
    return {
      ...state,
      history: commit(state, null, `Added ${room.name}`),
      rooms: [...state.rooms, room],
      openings: [...state.openings, ...openings],
      clipboard: { type: 'room', room, openings },
      selection: { type: 'room', id: room.id },
      tool: 'select',
    }
  }

  if (clipboard.type === 'furniture') {
    const shape = {
      ...clipboard.item,
      id: newId(),
      name: copyName(
        clipboard.item.name,
        state.furniture.map((f) => f.name),
      ),
    }
    // Offset first and then looked for somewhere free from there, so a copy
    // made against a wall steps along it rather than into it.
    const item: Furniture = {
      ...shape,
      ...freeSpot(
        state,
        shape,
        { x: clipboard.item.x + offset, y: clipboard.item.y + offset },
        PASTE_REACH,
      ),
    }
    return {
      ...state,
      history: commit(state, null, `Added ${item.name}`),
      furniture: [...state.furniture, item],
      clipboard: { type: 'furniture', item },
      selection: { type: 'furniture', id: item.id },
      tool: 'select',
    }
  }

  // An opening has nowhere to be but a wall, so a copy goes back on the wall
  // it came off — and nowhere at all once that wall has been taken down.
  const source = clipboard.opening
  const room = state.rooms.find((r) => r.id === source.roomId)
  const wall = room && wallAt(room.points, source.wall)
  if (!room || !wall) return state
  const width = fittedWidth(source.width, wall.length)
  // One width along the wall, or back the other way when the original is
  // already at that end, so the copy stands beside it rather than inside it.
  const step = width / wall.length
  const t = clampT(
    source.t + (source.t + step > 1 - step / 2 ? -step : step),
    width,
    wall.length,
  )
  const opening: Opening = { ...source, id: newId(), width, t }
  return {
    ...state,
    history: commit(
      state,
      null,
      `Added ${openingName(opening.kind)} to ${room.name}`,
    ),
    openings: [...state.openings, opening],
    clipboard: { type: 'opening', opening },
    selection: { type: 'opening', id: opening.id },
    tool: 'select',
  }
}

/**
 * Zoom the view without moving what is in the middle of the canvas, which is
 * what the toolbar's zoom controls want: there is no pointer to zoom towards.
 */
function zoomCentred(state: PlannerState, nextScale: number): Viewport {
  const anchor = { x: state.size.width / 2, y: state.size.height / 2 }
  return zoomAt(state.viewport, anchor, clampScale(nextScale))
}

// --- projects ---------------------------------------------------------------

/**
 * How the view is set on a plan just opened: framed around what is drawn on
 * it, or, on a plan with nothing drawn on it yet, with the world origin in the
 * middle of the canvas, which is where a plan started from scratch grows out
 * from.
 */
function framedOn(
  state: PlannerState,
  plan: { rooms: Array<Room>; furniture: Array<Furniture> },
): Viewport {
  const bounds = planBounds(plan.rooms, plan.furniture)
  if (!bounds || state.size.width === 0) {
    return {
      tx: state.size.width / 2,
      ty: state.size.height / 2,
      scale: DEFAULT_SCALE,
    }
  }
  return fitViewport(bounds, state.size.width, state.size.height)
}

/**
 * The library as it stands, with the open project brought up to date from the
 * plan being edited — which has been the real one since the first thing was
 * drawn on it. Everything that writes the library down, or hands it from one
 * project to the next, reads it through here rather than off `state.projects`,
 * where the open entry is always a step behind.
 */
function libraryOf(state: PlannerState): Library {
  return {
    version: 1,
    projects: state.projects.map((p) =>
      p.id === state.projectId
        ? {
            ...p,
            rooms: state.rooms,
            furniture: state.furniture,
            openings: state.openings,
          }
        : p,
    ),
  }
}

/** A plan with nothing on it: what the editor shows when the URL names none. */
const NO_PLAN = { rooms: [], furniture: [], openings: [] }

/**
 * Open the project the URL names: its plan becomes the plan being edited,
 * framed in the view and with the history started over, there being nothing in
 * a plan just opened that an undo could take back.
 *
 * An id naming no project opens on nothing rather than on the wrong plan — the
 * page that asked for it sends the reader back to the list.
 */
function opened(
  state: PlannerState,
  library: Library,
  id: string | null,
): PlannerState {
  const plan = library.projects.find((p) => p.id === id) ?? NO_PLAN
  return {
    ...state,
    projects: library.projects,
    projectId: id,
    rooms: plan.rooms,
    furniture: plan.furniture,
    openings: plan.openings,
    selection: null,
    renaming: null,
    draft: null,
    rect: null,
    tool: 'select',
    viewport: framedOn(state, plan),
    history: EMPTY_HISTORY,
  }
}

/**
 * A blank plan, under the first `Plan n` the library has left free and an id
 * of its own, which is what a plan is known by from the URL down.
 */
function blankProject(taken: Array<string>): Project {
  let n = 1
  while (taken.includes(`Plan ${n}`)) n += 1
  return {
    id: newId(),
    name: `Plan ${n}`,
    rooms: [],
    furniture: [],
    openings: [],
  }
}

export const plannerStore = createStore(initialState, ({ setState, get }) => ({
  setTool(tool: Tool) {
    setState((s) => ({
      ...s,
      tool,
      draft: tool === 'room' ? s.draft : null,
      rect: tool === 'rect' ? s.rect : null,
      renaming: null,
    }))
  },

  toggleSnap() {
    setState((s) => ({ ...s, snap: !s.snap }))
  },

  toggleCollide() {
    setState((s) => ({ ...s, collide: !s.collide }))
  },

  setCollide(collide: boolean) {
    setState((s) => ({ ...s, collide }))
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

  /** Step the zoom, about the middle of the canvas. */
  zoomBy(factor: number) {
    setState((s) => ({
      ...s,
      viewport: zoomCentred(s, s.viewport.scale * factor),
    }))
  },

  /** Go to an exact zoom, for the readout that resets it to life size. */
  zoomTo(scale: number) {
    setState((s) => ({ ...s, viewport: zoomCentred(s, scale) }))
  },

  fit() {
    setState((s) => ({ ...s, viewport: framedOn(s, s) }))
  },

  select(selection: Selection) {
    // Whatever else the click did, it took the pointer off the name being
    // typed, and the field it was typed in goes with it.
    setState((s) => ({ ...s, selection, renaming: null }))
  },

  /**
   * Put a name up to be typed over where it is written on the plan, rather
   * than in the inspector's field for it. What is being renamed is selected in
   * the same move, so the panel is describing the thing under the cursor.
   */
  beginRename(type: 'room' | 'furniture', id: string) {
    setState((s) => ({
      ...s,
      selection: { type, id },
      renaming: { type, id },
    }))
  },

  /** Put the name field away, whether what was typed was kept or dropped. */
  endRename() {
    setState((s) => (s.renaming === null ? s : { ...s, renaming: null }))
  },

  /**
   * Take a copy of the selection, to be put down again with `paste`. Nothing
   * about the plan changes, so there is no step here to undo.
   */
  copySelection() {
    setState((s) => {
      const clipboard = copyOf(s)
      return clipboard ? { ...s, clipboard } : s
    })
  },

  /** Put down another of whatever was last copied. */
  paste() {
    setState((s) => (s.clipboard ? pasted(s, s.clipboard) : s))
  },

  /**
   * Copy and paste in one, and without disturbing the clipboard — the way a
   * row of the same chair gets laid out, and the one thing a copy is most
   * often wanted for.
   */
  duplicateSelection() {
    setState((s) => {
      const copy = copyOf(s)
      return copy ? { ...pasted(s, copy), clipboard: s.clipboard } : s
    })
  },

  addFurniture(kind: FurnitureKind) {
    const state = get()
    const preset = FURNITURE_PRESETS[kind]
    const raw = viewCentre(state)
    const centre = snapPoint(raw, activeSnapStep(state))
    const count = state.furniture.filter((f) => f.kind === kind).length + 1
    const shape = {
      id: newId(),
      kind,
      name: `${preset.label} ${count}`,
      w: preset.w,
      h: preset.h,
      rotation: 0,
    }
    // Somewhere the new item can actually stand, so that it is never dropped
    // inside a wall or hidden underneath the last one.
    const item: Furniture = { ...shape, ...freeSpot(state, shape, centre) }
    setState((s) => ({
      ...s,
      history: commit(s, null, `Added ${item.name}`),
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
    if (!room) return
    const frame = wallAt(room.points, wall)
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
      history: commit(s, null, `Added ${openingName(kind)} to ${room.name}`),
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
    setState((s) => {
      const current = s.openings.find((o) => o.id === id)
      if (!current) return s
      return {
        ...s,
        history: commit(
          s,
          patchLabel('opening', id, patch),
          describeOpening(current, patch),
        ),
        openings: s.openings.map((o) => {
          if (o.id !== id) return o
          const next = { ...o, ...patch }
          const wall = openingWall(s.rooms, next)
          if (!wall) return next
          const width = fittedWidth(next.width, wall.length)
          return { ...next, width, t: clampT(next.t, width, wall.length) }
        }),
      }
    })
  },

  updateFurniture(id: string, patch: Partial<Furniture>) {
    setState((s) => {
      const current = s.furniture.find((f) => f.id === id)
      if (!current) return s
      // The step is named after what was asked for rather than what the walls
      // allowed, so a drag held against one still reads as the one move it is.
      const next = placed(s, current, { ...current, ...patch })
      return {
        ...s,
        history: commit(
          s,
          patchLabel('furniture', id, patch),
          describeFurniture(current, patch),
        ),
        furniture: s.furniture.map((f) => (f.id === id ? next : f)),
      }
    })
  },

  updateRoom(id: string, patch: Partial<Room>) {
    setState((s) => {
      const current = s.rooms.find((r) => r.id === id)
      if (!current) return s
      return {
        ...s,
        history: commit(
          s,
          patchLabel('room', id, patch),
          describeRoom(current, patch),
        ),
        rooms: s.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)),
      }
    })
  },

  moveVertex(roomId: string, index: number, point: Point) {
    setState((s) => {
      const room = s.rooms.find((r) => r.id === roomId)
      if (!room) return s
      return {
        ...s,
        history: commit(
          s,
          `vertex:${roomId}:${index}`,
          `Moved a corner of ${room.name}`,
        ),
        rooms: s.rooms.map((r) =>
          r.id === roomId
            ? {
                ...r,
                points: r.points.map((p, i) => (i === index ? point : p)),
              }
            : r,
        ),
      }
    })
  },

  /**
   * Swap in the outline a wall being pushed has left behind. The corners are
   * the same corners in the same order — only the two at the ends of that wall
   * have moved — so the doors and windows stay on the walls they were cut into
   * and stretch with them, exactly as they do when a corner is dragged.
   *
   * `index` names the wall only so that the history can tell one push from the
   * next: pushing two sides in turn is two steps to undo, not one.
   */
  moveWall(roomId: string, index: number, points: Array<Point>) {
    setState((s) => {
      const room = s.rooms.find((r) => r.id === roomId)
      if (!room) return s
      // A push that went nowhere — held at the far side of the room, or not far
      // enough to cross a snap step — is not a change, and must not leave a
      // step to undo. Both presses of a double-click land as a still pointer,
      // and would otherwise bury the corner they add under a pair of no-ops.
      if (sameOutline(room.points, points)) return s
      return {
        ...s,
        history: commit(
          s,
          `wall:${roomId}:${index}`,
          `Moved a wall of ${room.name}`,
        ),
        rooms: s.rooms.map((r) => (r.id === roomId ? { ...r, points } : r)),
      }
    })
  },

  insertVertex(roomId: string, afterIndex: number, point: Point) {
    setState((s) => {
      const room = s.rooms.find((r) => r.id === roomId)
      if (!room) return s
      const points = [...room.points]
      points.splice(afterIndex + 1, 0, point)
      return reshaped(
        { ...s, history: commit(s, null, `Added a corner to ${room.name}`) },
        room,
        points,
      )
    })
  },

  deleteVertex(roomId: string, index: number) {
    setState((s) => {
      const room = s.rooms.find((r) => r.id === roomId)
      if (!room || room.points.length <= 3) return s
      return reshaped(
        {
          ...s,
          history: commit(s, null, `Removed a corner from ${room.name}`),
        },
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
        history: commit(s, null, `Deleted ${selectionName(s)}`),
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
        renaming: null,
      }
    })
  },

  nudgeSelection(dx: number, dy: number) {
    setState((s) => {
      if (!s.selection) return s
      const { type, id } = s.selection
      const history = commit(
        s,
        `nudge:${type}:${id}`,
        `Moved ${selectionName(s)}`,
      )
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
          f.id === id ? placed(s, f, { ...f, x: f.x + dx, y: f.y + dy }) : f,
        ),
      }
    })
  },

  addDraftPoint(point: Point) {
    setState((s) => ({
      ...s,
      history: commit(s, null, 'Placed a corner'),
      draft: [...(s.draft ?? []), point],
    }))
  },

  popDraftPoint() {
    setState((s) => {
      if (!s.draft) return s
      const draft = s.draft.slice(0, -1)
      return {
        ...s,
        history: commit(s, null, 'Removed a corner'),
        draft: draft.length === 0 ? null : draft,
      }
    })
  },

  cancelDraft() {
    setState((s) =>
      s.draft === null
        ? s
        : {
            ...s,
            history: commit(s, null, 'Discarded the outline'),
            draft: null,
          },
    )
  },

  /** Close the in-progress polygon into a room. Needs at least 3 vertices. */
  commitDraft() {
    setState((s) => {
      if (!s.draft) return s
      if (s.draft.length < 3) {
        return {
          ...s,
          history: commit(s, null, 'Discarded the outline'),
          draft: null,
        }
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
        ...restore(s, step.snapshot),
        history: {
          past: s.history.past.slice(0, -1),
          // The step keeps its name on the way across: it is the same change,
          // now the one a redo would put back.
          future: [
            ...s.history.future,
            { snapshot: snapshotOf(s), text: step.text },
          ],
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
        ...restore(s, step.snapshot),
        history: {
          past: [
            ...s.history.past,
            { snapshot: snapshotOf(s), text: step.text },
          ],
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

  // --- projects -------------------------------------------------------------

  /**
   * Put the saved library in place. Nothing is open at the point this runs —
   * the routes read the library back before they ask for a plan — so it leaves
   * whatever is being drawn on alone.
   */
  loadLibrary(library: Library) {
    setState((s) => ({ ...s, projects: library.projects, restored: true }))
  },

  /**
   * Show the plan a URL names, putting whatever was being drawn on back in the
   * library on the way past. Standing still is not a change: asked for the
   * plan already open, it leaves the view and the history where they are.
   */
  openProject(id: string | null) {
    setState((s) => (id === s.projectId ? s : opened(s, libraryOf(s), id)))
  },

  /**
   * Put the plan being drawn on back in the library, and leave the editor.
   * Called when the editor comes off the page, which is what lets everything
   * else read `projects` straight: with nothing open there is no working copy
   * out in front of it, and the list on the way in can be trusted.
   */
  closeProject() {
    setState((s) => ({
      ...s,
      projects: libraryOf(s).projects,
      projectId: null,
    }))
  },

  /** Add a blank plan to the library, and say what to point the URL at. */
  newProject(): string {
    const plan = blankProject(get().projects.map((p) => p.name))
    setState((s) => ({
      ...s,
      projects: [...libraryOf(s).projects, plan],
    }))
    return plan.id
  },

  /**
   * Take a copy of the open plan, which is how one layout is tried against
   * another rather than drawn over it. Returns the copy's id, for the URL.
   */
  duplicateProject(): string | null {
    const state = get()
    const open = libraryOf(state).projects.find((p) => p.id === state.projectId)
    if (!open) return null
    const plan: Project = {
      ...open,
      id: newId(),
      name: copyName(
        open.name,
        state.projects.map((p) => p.name),
      ),
    }
    setState((s) => ({ ...s, projects: [...libraryOf(s).projects, plan] }))
    return plan.id
  },

  /** Rename the open project. Its name is not part of what an undo takes back. */
  renameProject(name: string) {
    setState((s) => ({
      ...s,
      projects: s.projects.map((p) =>
        p.id === s.projectId ? { ...p, name } : p,
      ),
    }))
  },

  /**
   * Throw a project away, for good: a plan deleted is not a change to a plan,
   * and there is no undo on this side of the editor. Throwing away the open
   * one leaves the editor with nothing to show, which is the page's cue to go
   * back to the list.
   */
  deleteProject(id: string) {
    setState((s) => {
      const library = libraryOf(s)
      const projects = library.projects.filter((p) => p.id !== id)
      if (projects.length === library.projects.length) return s
      return id === s.projectId
        ? opened(s, { ...library, projects }, null)
        : { ...s, projects }
    })
  },

  /**
   * Put plans that came from somewhere else — GitHub — into the library, over
   * any already there under the same id.
   *
   * The plan being drawn on is the one case worth spelling out. If it is among
   * them, the drawing on the canvas is replaced too, or the editor would go on
   * showing the copy that was just written over and save it back on the next
   * keystroke. The history goes with it: the steps in it are steps back into a
   * plan that is no longer the one open, and an undo across that seam would
   * put half of the old plan back. The view is left where it is — the reader
   * is looking at a room, and having accepted a change to it should still be
   * looking at it.
   *
   * Nothing here is undoable, and nothing here is deleted: a plan that has
   * gone from the repository is only unlinked from it, and stays in the
   * library as a local plan.
   */
  upsertProjects(incoming: Array<Project>) {
    if (incoming.length === 0) return
    setState((s) => {
      const byId = new Map(incoming.map((p) => [p.id, p]))
      const library = libraryOf(s)
      const known = new Set(library.projects.map((p) => p.id))
      const projects = [
        ...library.projects.map((p) => byId.get(p.id) ?? p),
        ...incoming.filter((p) => !known.has(p.id)),
      ]

      const open = s.projectId === null ? undefined : byId.get(s.projectId)
      if (!open) return { ...s, projects }

      return {
        ...s,
        projects,
        rooms: open.rooms,
        furniture: open.furniture,
        openings: open.openings,
        selection: null,
        renaming: null,
        draft: null,
        rect: null,
        history: EMPTY_HISTORY,
      }
    })
  },
}))

/**
 * Every plan the library holds, the open one brought up to date from what is
 * being drawn. This is the list anything outside the editor should read —
 * `state.projects` has the open plan as it was last written down, which is a
 * keystroke behind for as long as one is open.
 */
export function currentProjects(state: PlannerState): Array<Project> {
  return libraryOf(state).projects
}

// --- persistence ------------------------------------------------------------

const LIBRARY_KEY = 'rmplnr.projects.v1'
const PREFS_KEY = 'rmplnr.prefs.v1'

/** The one plan the editor saved before there were projects to keep them in. */
const PLAN_KEY = 'rmplnr.plan.v1'

/**
 * Openings still hanging on a wall that is there to hang on. One whose room or
 * wall has since gone has nothing to hold it, and would otherwise sit in the
 * plan doing nothing for ever.
 */
function attached(
  rooms: Array<Room>,
  openings: Array<Opening>,
): Array<Opening> {
  return openings.filter((o) => {
    const room = rooms.find((r) => r.id === o.roomId)
    return room !== undefined && o.wall < room.points.length
  })
}

/**
 * The plan saved before projects, if one is still there, under an id and a
 * name of its own so that it takes its place among them. It is left where it
 * lies rather than cleared away once read: it costs nothing, and it is the
 * only copy until the library beside it has been written for the first time.
 */
function loadStoredPlan(): Project | null {
  const raw = localStorage.getItem(PLAN_KEY)
  if (!raw) return null
  const parsed = PlanSchema.safeParse(JSON.parse(raw))
  if (!parsed.success) return null
  const { rooms, furniture, openings } = parsed.data
  return {
    id: newId(),
    name: 'Plan 1',
    rooms,
    furniture,
    openings: attached(rooms, openings),
  }
}

/**
 * Read the saved library, carrying across the single plan saved before there
 * were projects for the times nothing has been saved since. Returns null when
 * there is nothing stored, or when what is stored no longer matches the
 * schema, so stale data can never crash the editor rather than merely leave it
 * with nothing to open.
 */
function readLibrary(): Library | null {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY)
    if (!raw) {
      const plan = loadStoredPlan()
      return plan && { version: 1, projects: [plan] }
    }
    const parsed = LibrarySchema.safeParse(JSON.parse(raw))
    if (!parsed.success) return null
    return {
      version: 1,
      projects: parsed.data.projects.map((p) => ({
        ...p,
        openings: attached(p.rooms, p.openings),
      })),
    }
  } catch {
    return null
  }
}

/**
 * Read the saved editor preferences, on the same be-forgiving terms as the
 * plan: anything unreadable falls back to the defaults. Client-only.
 */
function loadStoredPrefs(): Prefs | null {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return null
    const parsed = PrefsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Persist the library and the preferences on change. Returns an unsubscribe. */
function startAutosave(debounceMs = 300): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined

  const subscription = plannerStore.subscribe(() => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      const { units, collide } = plannerStore.state
      try {
        localStorage.setItem(
          LIBRARY_KEY,
          JSON.stringify(libraryOf(plannerStore.state)),
        )
        localStorage.setItem(
          PREFS_KEY,
          JSON.stringify({ version: 1, units, collide }),
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

/**
 * Bring back what the browser was left holding — the library, and the
 * preferences it is read through — and keep writing it down from then on.
 *
 * Every page that touches a plan calls this before it does, and only the first
 * call does anything: the library belongs to the app rather than to any one
 * page, and reading it twice would talk over an edit still waiting to be
 * saved. localStorage is client-only, so this must be called from an effect,
 * never during a render the server also has to make.
 */
export function restoreLibrary(): void {
  if (plannerStore.state.restored) return
  // Subscribed before anything is read rather than after, so that what the
  // read makes of what it found is written straight back down. A plan carried
  // over from before there were projects is given an id on the way in, and an
  // id is what its URL is: it had better be the same one next time.
  startAutosave()
  plannerStore.actions.loadLibrary(
    readLibrary() ?? { version: 1, projects: [] },
  )
  const prefs = loadStoredPrefs()
  if (prefs) {
    plannerStore.actions.setUnits(prefs.units)
    plannerStore.actions.setCollide(prefs.collide)
  }
}
