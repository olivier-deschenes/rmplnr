import { createStore } from '@tanstack/store'

import { DEFAULT_ROOM, FURNITURE_PRESETS } from './presets.ts'
import {
  DEFAULT_CLOSET,
  closetSize,
  placeCloset,
  reattachClosets,
  reflowClosets,
} from './closets.ts'
import {
  clampScale,
  fitViewport,
  planBounds,
  rectPolygon,
  rotatePolygon,
  screenToWorld,
  snapPoint,
  snapValue,
  translatePolygon,
  zoomAt,
} from './geometry.ts'
import {
  clampT,
  fittedWidth,
  openingInWall,
  openingWall,
  reattachOpenings,
  wallAt,
} from './openings.ts'
import { blockersFor, fits, settleFurniture } from './collision.ts'
import { mergeLibraries, sameLibrary, samePlan } from './libraryMerge.ts'
import { EMPTY_HISTORY, pushHistory, snapshotOf } from './history.ts'
import {
  describeFurniture,
  describeOpening,
  describeRoom,
  openingName,
  selectionName,
} from './describe.ts'
import { SNAP_STEP } from './units.ts'
import { editConnectedWall } from './walls.ts'
import {
  DEFAULT_SCALE,
  LibrarySchema,
  MIN_SIZE,
  PlanSchema,
  PrefsSchema,
  ProjectNameSchema,
  StoredLibrarySchema,
} from './types.ts'

import type { ConflictedPlan } from './libraryMerge.ts'
import type { History, Snapshot } from './history.ts'
import type { WallGeometryChange } from './geometry.ts'
import type {
  Clipboard,
  CustomFurniturePreset,
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

/**
 * How a change gets from the canvas into the browser's storage: `saving` from
 * the moment it lands until it is written down, `saved` once it is, and
 * `error` when the browser refused to take it.
 */
export type SaveStatus = 'saved' | 'saving' | 'error'

/** Why a write was refused, in the terms the reader can act on. */
export type SaveFailure = 'quota' | 'blocked' | 'unknown'

export type Persistence = {
  status: SaveStatus
  /** What went wrong last, kept while a retry is in flight. */
  failure: SaveFailure | null
}

/**
 * Plans this tab and another tab have both drawn on since they last agreed,
 * which is the one thing two tabs cannot be left to settle between themselves.
 * Everything else merges; this waits on the reader.
 */
export type TabConflict = { plans: Array<ConflictedPlan> }

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
  /** Reusable footprints saved locally from furniture in any plan. */
  customFurniturePresets: Array<CustomFurniturePreset>
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
  /**
   * Where the library stands with the browser's storage. Nothing to save is
   * saved, so this starts where it will spend most of its life.
   */
  persistence: Persistence
  /**
   * The plans another tab has changed under this one, if it has. Nothing is
   * written down while this is set: the other tab's copy stays where it is
   * until the reader has said which of the two versions to keep.
   */
  conflict: TabConflict | null
}

const initialState: PlannerState = {
  projects: [],
  restored: false,
  projectId: null,
  rooms: [],
  furniture: [],
  customFurniturePresets: [],
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
  persistence: { status: 'saved', failure: null },
  conflict: null,
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
  // A room lands locked: the shape has just been traced, and the very next
  // click is far more likely to be aimed at something else than at dragging it
  // somewhere new. The inspector's padlock lets it go again.
  const room: Room = {
    id: newId(),
    name: `Room ${state.rooms.length + 1}`,
    points,
    locked: true,
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
  const rooms = reattachClosets(
    state.rooms.map((r) => (r.id === room.id ? { ...r, points } : r)),
    room.id,
    room.points,
    points,
  )
  const openings = reattachOpenings(
    state.openings,
    room.id,
    room.points,
    points,
  )
  return {
    ...state,
    ...flowedClosets(rooms, openings),
  }
}

/**
 * Keep attached closets on their host rooms, then fit the independent openings
 * riding on their walls if the closet became shorter.
 */
function flowedClosets(
  rooms: Array<Room>,
  openings: Array<Opening>,
): { rooms: Array<Room>; openings: Array<Opening> } {
  const flowed = reflowClosets(rooms)
  const closets = new Set(
    flowed.filter((room) => room.kind === 'closet').map((room) => room.id),
  )
  return {
    rooms: flowed,
    openings: openings.map((opening) => {
      if (!closets.has(opening.roomId)) return opening
      const wall = openingWall(flowed, opening)
      if (!wall) return opening
      const width = fittedWidth(opening.width, wall.length)
      return { ...opening, width, t: clampT(opening.t, width, wall.length) }
    }),
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
  // A rug is meant to arrive under a table rather than stepping away from it.
  if (shape.collides === false) return centre
  const blockers = inTheWayOf(state)
  for (const offset of CASCADE_SPOTS) {
    // The spots come out ring by ring, so the first one beyond the reach is
    // where the search stops.
    if (Math.max(Math.abs(offset.x), Math.abs(offset.y)) > reach) break
    const spot = { x: centre.x + offset.x, y: centre.y + offset.y }
    const taken = state.furniture.some(
      (f) =>
        f.collides !== false &&
        Math.abs(f.x - spot.x) < 1 &&
        Math.abs(f.y - spot.y) < 1,
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
  if (
    !state.collide ||
    from.collides === false ||
    to.collides === false ||
    !displaced(from, to)
  )
    return to
  return settleFurniture(from, to, inTheWayOf(state, from.id))
}

type FurnitureFootprint = Pick<Furniture, 'kind' | 'w' | 'h' | 'collides'>

/** Drop one built-in or custom footprint into the current view. */
function withFurniture(
  state: PlannerState,
  footprint: FurnitureFootprint,
  name: string,
): PlannerState {
  const raw = viewCentre(state)
  const centre = snapPoint(raw, activeSnapStep(state))
  const shape = {
    id: newId(),
    kind: footprint.kind,
    w: footprint.w,
    h: footprint.h,
    collides: footprint.collides,
    name,
    rotation: 0,
  }
  const item: Furniture = { ...shape, ...freeSpot(state, shape, centre) }
  return {
    ...state,
    history: commit(state, null, `Added ${item.name}`),
    furniture: [...state.furniture, item],
    selection: { type: 'furniture', id: item.id },
    tool: 'select',
  }
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
    // A closet's place comes from its host wall, so an offset paste would no
    // longer be attached. Add another from the wall instead.
    if (room?.kind === 'closet') return null
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
  if (selection.type !== 'opening') return null
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

/** Take on a complete library, redrawing the open plan only when it changed. */
function adopted(state: PlannerState, library: Library): PlannerState {
  const projects = library.projects
  const open =
    state.projectId === null
      ? undefined
      : projects.find((project) => project.id === state.projectId)
  if (!open || samePlan(open, state)) return { ...state, projects }
  return {
    ...state,
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
}

/** Add or replace plans without disturbing an unrelated open plan. */
function upserted(state: PlannerState, incoming: Array<Project>): PlannerState {
  const byId = new Map(incoming.map((project) => [project.id, project]))
  const library = libraryOf(state)
  const known = new Set(library.projects.map((project) => project.id))
  const projects = [
    ...library.projects.map((project) => byId.get(project.id) ?? project),
    ...incoming.filter((project) => !known.has(project.id)),
  ]

  const open = state.projectId === null ? undefined : byId.get(state.projectId)
  if (!open) return { ...state, projects }

  return {
    ...state,
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

  setCustomFurniturePresets(presets: Array<CustomFurniturePreset>) {
    setState((s) => ({ ...s, customFurniturePresets: presets }))
  },

  setViewport(viewport: Viewport) {
    setState((s) => ({ ...s, viewport }))
  },

  /** Keep the whole plan visible whenever the canvas changes shape. */
  setSize(width: number, height: number) {
    setState((s) => {
      if (s.size.width === width && s.size.height === height) return s
      const resized = { ...s, size: { width, height } }
      return { ...resized, viewport: framedOn(resized, resized) }
    })
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
    const preset = FURNITURE_PRESETS[kind]
    setState((s) => {
      const count = s.furniture.filter((item) => item.kind === kind).length + 1
      return withFurniture(
        s,
        {
          kind,
          w: preset.w,
          h: preset.h,
          collides: preset.collides,
        },
        `${preset.label} ${count}`,
      )
    })
  },

  /** Add one locally saved footprint, using its name until that name is taken. */
  addCustomFurniture(presetId: string) {
    setState((s) => {
      const preset = s.customFurniturePresets.find(
        (candidate) => candidate.id === presetId,
      )
      if (!preset) return s
      const taken = s.furniture.map((item) => item.name)
      const name = taken.includes(preset.name)
        ? copyName(preset.name, taken)
        : preset.name
      return withFurniture(s, preset, name)
    })
  },

  /** Add one already-validated measured footprint, such as an AI import. */
  addFurnitureFootprint(
    footprint: Pick<
      CustomFurniturePreset,
      'name' | 'kind' | 'w' | 'h' | 'collides'
    >,
  ) {
    setState((s) => {
      const taken = s.furniture.map((item) => item.name)
      const name = taken.includes(footprint.name)
        ? copyName(footprint.name, taken)
        : footprint.name
      return withFurniture(s, footprint, name)
    })
  },

  /** Save the selected item's current name, size, glyph and solidity for reuse. */
  saveFurniturePreset(itemId: string): string | null {
    const item = get().furniture.find((candidate) => candidate.id === itemId)
    const name = item?.name.trim() ?? ''
    if (!item || name.length === 0 || name.length > 80) return null
    const preset: CustomFurniturePreset = {
      id: newId(),
      name,
      kind: item.kind,
      w: item.w,
      h: item.h,
      collides: item.collides !== false,
    }
    setState((s) => ({
      ...s,
      customFurniturePresets: [...s.customFurniturePresets, preset],
    }))
    return preset.id
  },

  /** Rename one local preset without changing furniture already in a plan. */
  renameFurniturePreset(presetId: string, nextName: string): boolean {
    const name = nextName.trim()
    if (name.length === 0 || name.length > 80) return false
    const current = get().customFurniturePresets.find(
      (preset) => preset.id === presetId,
    )
    if (!current) return false
    if (current.name === name) return true
    setState((s) => ({
      ...s,
      customFurniturePresets: s.customFurniturePresets.map((preset) =>
        preset.id === presetId ? { ...preset, name } : preset,
      ),
    }))
    return true
  },

  deleteFurniturePreset(presetId: string) {
    setState((s) => ({
      ...s,
      customFurniturePresets: s.customFurniturePresets.filter(
        (preset) => preset.id !== presetId,
      ),
    }))
  },

  /**
   * Put an open-front recess against the outside of a wall, then add an ordinary
   * sliding door to it. The door stays independently selectable and editable.
   */
  addCloset(roomId: string, wall: number, t: number) {
    const state = get()
    const host = state.rooms.find(
      (room) => room.id === roomId && room.kind !== 'closet',
    )
    const frame = host && wallAt(host.points, wall)
    if (!host || !frame) return

    const id = newId()
    const count =
      state.rooms.filter((room) => room.kind === 'closet').length + 1
    const attachment = { roomId, wall, t }
    const placement = placeCloset(
      frame,
      attachment,
      DEFAULT_CLOSET.width,
      DEFAULT_CLOSET.depth,
    )
    const closet: Room = {
      id,
      kind: 'closet',
      name: `Closet ${count}`,
      points: placement.points,
      attachment: placement.attachment,
    }
    const opening = openingInWall(wallAt(closet.points, 0)!, {
      id: newId(),
      kind: 'sliding-door',
      roomId: id,
      wall: 0,
      t: 0.5,
    })

    setState((s) => ({
      ...s,
      history: commit(s, null, `Added ${closet.name} to ${host.name}`),
      rooms: [...s.rooms, closet],
      openings: [...s.openings, opening],
      selection: { type: 'room', id },
      tool: 'select',
    }))
  },

  /** Resize a closet or slide it along the wall it remains attached to. */
  updateCloset(
    id: string,
    patch: { width?: number; depth?: number; t?: number },
  ) {
    setState((s) => {
      const closet = s.rooms.find(
        (room) => room.id === id && room.kind === 'closet' && room.attachment,
      )
      const attachment = closet?.attachment
      const host =
        attachment && s.rooms.find((room) => room.id === attachment.roomId)
      const frame = host && wallAt(host.points, attachment.wall)
      if (!closet || !attachment || !frame) return s

      const current = closetSize(closet)
      const placement = placeCloset(
        frame,
        { ...attachment, t: patch.t ?? attachment.t },
        patch.width ?? current.width,
        patch.depth ?? current.depth,
      )
      const rooms = s.rooms.map((room) =>
        room.id === id
          ? {
              ...room,
              points: placement.points,
              attachment: placement.attachment,
            }
          : room,
      )
      const openings = s.openings.map((opening) => {
        if (opening.roomId !== closet.id) return opening
        const width = fittedWidth(opening.width, placement.width)
        return {
          ...opening,
          width,
          t: clampT(opening.t, width, placement.width),
        }
      })
      return {
        ...s,
        history: commit(
          s,
          patchLabel('closet', id, patch),
          patch.t === undefined
            ? `Resized ${closet.name}`
            : `Moved ${closet.name}`,
        ),
        rooms,
        openings,
      }
    })
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
    const opening = openingInWall(frame, {
      id: newId(),
      kind,
      roomId,
      wall,
      t,
    })
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
      // A locked room still answers to a rename and to the padlock itself;
      // it is only its outline that is held.
      if (patch.points && current.locked) return s
      const rooms = s.rooms.map((room) =>
        room.id === id ? { ...room, ...patch } : room,
      )
      const plan = patch.points
        ? flowedClosets(rooms, s.openings)
        : { rooms, openings: s.openings }
      return {
        ...s,
        history: commit(
          s,
          patchLabel('room', id, patch),
          describeRoom(current, patch),
        ),
        ...plan,
      }
    })
  },

  /** Turn an ordinary room around its centre, carrying its attachments with it. */
  rotateRoom(id: string, degrees: number) {
    setState((s) => {
      const room = s.rooms.find((candidate) => candidate.id === id)
      const turn = degrees % 360
      if (
        !room ||
        room.kind === 'closet' ||
        room.locked ||
        !Number.isFinite(turn) ||
        Math.abs(turn) < 1e-9
      ) {
        return s
      }

      const rooms = s.rooms.map((candidate) =>
        candidate.id === id
          ? { ...candidate, points: rotatePolygon(candidate.points, turn) }
          : candidate,
      )
      return {
        ...s,
        history: commit(s, `rotate-room:${id}`, `Rotated ${room.name}`),
        ...flowedClosets(rooms, s.openings),
      }
    })
  },

  /** Hold a room where it is, or let it go again. */
  setRoomLocked(id: string, locked: boolean) {
    setState((s) => {
      const room = s.rooms.find((r) => r.id === id)
      if (!room || room.locked === locked) return s
      return {
        ...s,
        history: commit(
          s,
          null,
          `${locked ? 'Locked' : 'Unlocked'} ${room.name}`,
        ),
        rooms: s.rooms.map((candidate) =>
          candidate.id === id ? { ...candidate, locked } : candidate,
        ),
      }
    })
  },

  moveVertex(roomId: string, index: number, point: Point) {
    setState((s) => {
      const room = s.rooms.find((r) => r.id === roomId)
      if (!room || room.locked) return s
      const rooms = s.rooms.map((candidate) =>
        candidate.id === roomId
          ? {
              ...candidate,
              points: candidate.points.map((p, i) => (i === index ? point : p)),
            }
          : candidate,
      )
      return {
        ...s,
        history: commit(
          s,
          `vertex:${roomId}:${index}`,
          `Moved a corner of ${room.name}`,
        ),
        ...flowedClosets(rooms, s.openings),
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
      if (!room || room.locked) return s
      // A push that went nowhere — held at the far side of the room, or not far
      // enough to cross a snap step — is not a change, and must not leave a
      // step to undo. Both presses of a double-click land as a still pointer,
      // and would otherwise bury the corner they add under a pair of no-ops.
      if (sameOutline(room.points, points)) return s
      const rooms = s.rooms.map((candidate) =>
        candidate.id === roomId ? { ...candidate, points } : candidate,
      )
      return {
        ...s,
        history: commit(
          s,
          `wall:${roomId}:${index}`,
          `Moved a wall of ${room.name}`,
        ),
        ...flowedClosets(rooms, s.openings),
      }
    })
  },

  /**
   * Set a wall's measured length or angle in one atomic history step. Rooms
   * sharing the wall move with it; an edit that cannot keep the plan connected
   * returns its explanation and changes nothing.
   */
  setWallDimensions(
    roomId: string,
    index: number,
    change: WallGeometryChange,
  ): { ok: true } | { ok: false; error: string } {
    let outcome: { ok: true } | { ok: false; error: string } = {
      ok: false,
      error: 'The wall could not be changed.',
    }
    setState((s) => {
      const room = s.rooms.find((candidate) => candidate.id === roomId)
      if (!room) {
        outcome = { ok: false, error: 'This room no longer exists.' }
        return s
      }
      const result = editConnectedWall(
        s.rooms,
        s.openings,
        roomId,
        index,
        change,
      )
      if (!result.ok) {
        outcome = result
        return s
      }
      outcome = { ok: true }
      if (result.rooms === s.rooms && result.openings === s.openings) return s
      return {
        ...s,
        history: commit(s, null, `Changed wall ${index + 1} of ${room.name}`),
        rooms: result.rooms,
        openings: result.openings,
        selection: { type: 'wall', id: roomId, index },
      }
    })
    return outcome
  },

  insertVertex(roomId: string, afterIndex: number, point: Point) {
    setState((s) => {
      const room = s.rooms.find((r) => r.id === roomId)
      if (!room || room.locked) return s
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
      if (!room || room.locked || room.points.length <= 3) return s
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
      if (type === 'wall') return s
      const removedRooms = new Set<string>()
      if (type === 'room') {
        // A locked room is held against deletion too, and holds the closets
        // that would have come down with it.
        if (s.rooms.find((room) => room.id === id)?.locked) return s
        removedRooms.add(id)
        // A host room takes its attached closets with it; otherwise they would
        // be left floating with a reference to a wall that no longer exists.
        for (const room of s.rooms) {
          if (room.attachment?.roomId === id) removedRooms.add(room.id)
        }
      }
      return {
        ...s,
        history: commit(s, null, `Deleted ${selectionName(s)}`),
        rooms:
          type === 'room'
            ? s.rooms.filter((room) => !removedRooms.has(room.id))
            : s.rooms,
        furniture:
          type === 'furniture'
            ? s.furniture.filter((f) => f.id !== id)
            : s.furniture,
        // A room takes its doors and windows down with it.
        openings: s.openings.filter((o) =>
          type === 'room' ? !removedRooms.has(o.roomId) : o.id !== id,
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
      if (type === 'wall') return s
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
        const room = s.rooms.find((candidate) => candidate.id === id)
        if (room?.locked) return s
        const attachment = room?.attachment
        if (room?.kind === 'closet' && attachment) {
          const host = s.rooms.find(
            (candidate) => candidate.id === attachment.roomId,
          )
          const wall = host && wallAt(host.points, attachment.wall)
          if (!wall) return s
          const along = dx * wall.tangent.x + dy * wall.tangent.y
          const size = closetSize(room)
          const placement = placeCloset(
            wall,
            { ...attachment, t: attachment.t + along / wall.length },
            size.width,
            size.depth,
          )
          return {
            ...s,
            history,
            rooms: s.rooms.map((candidate) =>
              candidate.id === id
                ? {
                    ...candidate,
                    points: placement.points,
                    attachment: placement.attachment,
                  }
                : candidate,
            ),
          }
        }
        const rooms = s.rooms.map((candidate) =>
          candidate.id === id
            ? {
                ...candidate,
                points: translatePolygon(candidate.points, dx, dy),
              }
            : candidate,
        )
        return {
          ...s,
          history,
          ...flowedClosets(rooms, s.openings),
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
   * Say where the library stands with storage. Only the autosave calls this:
   * the status is a report of what actually reached the browser, and one set
   * from anywhere else would be a promise nothing had kept.
   *
   * Standing still is not a change — the same status set twice over must not
   * wake the editor, or a drag would repaint the bar on every frame.
   */
  setPersistence(persistence: Persistence) {
    setState((s) =>
      s.persistence.status === persistence.status &&
      s.persistence.failure === persistence.failure
        ? s
        : { ...s, persistence },
    )
  },

  /**
   * Say which plans another tab has changed under this one, or that none has.
   * Only the autosave calls this: it is a report of what is actually in this
   * browser's storage, and one set from anywhere else would stop the editor
   * saving over a change nobody had made.
   */
  setConflict(conflict: TabConflict | null) {
    setState((s) =>
      s.conflict === null && conflict === null ? s : { ...s, conflict },
    )
  },

  /**
   * Take on the library as another tab left it — merged with this tab's own
   * work, or chosen over it — in place of the one held here.
   *
   * The plan being drawn on is only taken back off the canvas if the drawing
   * itself has changed: another tab editing a different plan must not cost
   * this one its history, its selection, or the polygon half-traced on screen.
   * When it has changed, the history goes with it, the steps in it being steps
   * back into a plan that is no longer the one open.
   *
   * A plan the other tab deleted simply goes; the page showing it sends the
   * reader back to the list, the same as for any plan that is not there.
   */
  adoptLibrary(library: Library) {
    setState((s) => adopted(s, library))
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
    const parsed = ProjectNameSchema.safeParse(name)
    if (!parsed.success) return
    setState((s) => {
      const project = s.projects.find((p) => p.id === s.projectId)
      if (!project || project.name === parsed.data) return s
      return {
        ...s,
        projects: s.projects.map((p) =>
          p.id === s.projectId ? { ...p, name: parsed.data } : p,
        ),
      }
    })
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
   * Apply one already-validated external plan. A duplicate can either take
   * the existing plan's place or arrive under a fresh id and copy name.
   * Returns the id to open after the import.
   */
  importProject(project: Project, duplicate: 'replace' | 'copy'): string {
    const state = get()
    const projects = libraryOf(state).projects
    const imported: Project =
      duplicate === 'copy'
        ? {
            ...project,
            id: newId(),
            name: copyName(
              project.name,
              projects.map((candidate) => candidate.name),
            ),
          }
        : project
    setState((s) => upserted(s, [imported]))
    return imported.id
  },

  /** Replace the local plan library with one fully validated backup. */
  restoreBackup(library: Library) {
    setState((s) => adopted(s, library))
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
    setState((s) => upserted(s, incoming))
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
 * As much of the Web Storage API as the editor uses. Named so that a test can
 * hand in a store that is full, or one that throws the way a browser with site
 * data switched off does.
 */
export interface PlannerStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

/**
 * The browser's own storage, or null where there is none to be had: a browser
 * with site data blocked throws on the property itself rather than on the
 * first write, and a null here is what turns that into a visible error state
 * instead of an exception thrown out of an effect.
 */
function browserStorage(): PlannerStorage | null {
  try {
    // Typed through a partial global: `localStorage` is declared as always
    // being there, and the whole point here is the browsers where it is not.
    return (globalThis as Partial<typeof globalThis>).localStorage ?? null
  } catch {
    return null
  }
}

/**
 * What this tab calls itself when it writes the library down, made the first
 * time it is asked for rather than when this module loads: the server has no
 * tabs, and nothing on it should be spending randomness on one.
 */
let tab: string | null = null

function thisTab(): string {
  tab ??= newId()
  return tab
}

/** Where a write went wrong, in the terms the reader can do something about. */
function failureOf(error: unknown): SaveFailure {
  const name = error instanceof Error ? error.name : ''
  // Firefox has a name of its own for a full store, and both browsers throw a
  // SecurityError rather than a quota error when the storage is walled off.
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') {
    return 'quota'
  }
  return name === 'SecurityError' ? 'blocked' : 'unknown'
}

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
function loadStoredPlan(storage: PlannerStorage): Project | null {
  const raw = storage.getItem(PLAN_KEY)
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
function readLibrary(storage: PlannerStorage | null): Library | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(LIBRARY_KEY)
    if (!raw) {
      const plan = loadStoredPlan(storage)
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
 * The library as storage holds it this instant, stamp and all, or null where
 * there is nothing readable there. This is the one that reads the stamp: what
 * a tab is looking for in another tab's write is not a plan to open but a
 * revision to measure its own against.
 */
function readStored(storage: PlannerStorage | null): Stored | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(LIBRARY_KEY)
    if (!raw) return null
    const parsed = StoredLibrarySchema.safeParse(JSON.parse(raw))
    if (!parsed.success) return null
    return {
      projects: parsed.data.projects,
      writer: parsed.data.writer ?? null,
      revision: parsed.data.revision ?? 0,
    }
  } catch {
    return null
  }
}

/** The library in storage, under the stamp saying whose write left it there. */
type Stored = {
  projects: Array<Project>
  writer: string | null
  revision: number
}

/**
 * Read the saved editor preferences, on the same be-forgiving terms as the
 * plan: anything unreadable falls back to the defaults. Client-only.
 */
function readPrefs(storage: PlannerStorage | null): Prefs | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(PREFS_KEY)
    if (!raw) return null
    const parsed = PrefsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/**
 * The parts of the state that end up in storage, by reference. Everything else
 * — the view, the selection, the tool in hand — is not written down, and a
 * change to it is not a change worth another write. Comparing the references
 * is enough: every action builds new arrays for what it touches and passes the
 * rest through untouched.
 */
type Persisted = ReadonlyArray<unknown>

function persistedOf(state: PlannerState): Persisted {
  return [
    state.projects,
    state.projectId,
    state.rooms,
    state.furniture,
    state.openings,
    state.units,
    state.collide,
    state.customFurniturePresets,
  ]
}

function samePersisted(a: Persisted, b: Persisted): boolean {
  return a.every((value, i) => Object.is(value, b[i]))
}

export interface AutosaveOptions {
  /** Defaults to the browser's `localStorage`. */
  storage?: PlannerStorage | null
  /** Where the page's lifecycle events come from. Defaults to `window`. */
  lifecycle?: EventTarget | null
  debounceMs?: number
}

/**
 * The running autosave, so that a control in the editor can ask for the write
 * it is waiting on to happen now, or say how a clash with another tab is to be
 * settled. There is only ever one — the library belongs to the app rather than
 * to any one page.
 */
let autosave: {
  flush: () => void
  resolve: (take: 'mine' | 'theirs') => void
} | null = null

/**
 * Write the library out now rather than when the debounce is up. Retrying a
 * failed save is the same thing as flushing a pending one: nothing that failed
 * to be written is ever marked as written, so it is still waiting.
 */
export function saveNow(): void {
  autosave?.flush()
}

/**
 * Settle a clash with another tab by taking its version of the plans in
 * question, dropping what was drawn on them here since they last agreed.
 */
export function takeOtherTab(): void {
  autosave?.resolve('theirs')
}

/**
 * Settle a clash with another tab by keeping this tab's version, which is
 * written over the one the other tab left.
 */
export function keepThisTab(): void {
  autosave?.resolve('mine')
}

/**
 * Persist the library and the preferences on change, and say so as it goes:
 * `saving` from the moment an edit lands until it is safely down, `error` when
 * the browser refused it. Returns an unsubscribe.
 *
 * Three things keep the promise the status makes. A write is only marked done
 * once storage has actually taken it, so a refusal leaves the change pending
 * and the next edit — or a retry — tries it again. The pending write is
 * flushed when the page goes away, so the debounce cannot swallow the last
 * edit before a close. And nothing is ever written over a newer copy left by
 * another tab: every write looks first, and what it finds is either merged
 * into this tab or put to the reader.
 */
export function startAutosave({
  storage = browserStorage(),
  lifecycle = typeof window === 'undefined' ? null : window,
  debounceMs = 300,
}: AutosaveOptions = {}): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  /** What is waiting to be written, if anything. */
  let pending: Persisted | null = null
  /**
   * What storage is believed to hold, so that an unrelated change — a pan, a
   * selection, the tool in hand — writes nothing. It starts as what is in the
   * store right now: whatever is read back in afterwards arrives as new arrays
   * and is written down like any other change.
   */
  let saved: Persisted = persistedOf(plannerStore.state)

  const stored = readStored(storage)
  /**
   * The library this tab and every other last agreed on: what storage held
   * when this tab last read it or wrote it. It is what tells an edit made here
   * from one made next door, and so what a merge is measured against.
   */
  let base: Array<Project> = stored?.projects ?? []
  /** The highest revision this tab knows this browser's library to have had. */
  let revision = stored?.revision ?? 0
  /**
   * The other tab's library, held while the reader decides which version to
   * keep. Nothing is written while it is set.
   */
  let incoming: Stored | null = null

  /**
   * Take on what another tab has left in storage, as far as it can be taken on
   * without losing anything: `base` is what the two tabs last agreed on, so a
   * plan only one of them has touched can be taken from whichever touched it.
   * A plan both have drawn on goes to the reader instead, and until it comes
   * back nothing here is written.
   */
  const accept = (theirs: Stored, projects: Array<Project>): void => {
    incoming = null
    // Storage holds their copy, so from here that is what this tab's own work
    // is a change to, and what its next write is measured against.
    base = theirs.projects
    revision = theirs.revision
    plannerStore.actions.setConflict(null)
    plannerStore.actions.adoptLibrary({ version: 1, projects })
    // Adopting is a change like any other and has already come back round to
    // the subscriber below, which has marked it pending. Whether there is
    // really anything to write is the write's own question: a merge that came
    // to exactly what storage already holds writes nothing.
    persist()
  }

  /**
   * Catch up with storage before writing over it. Returns whether writing may
   * go ahead — false when another tab's copy is now waiting on the reader.
   */
  const catchUp = (): boolean => {
    if (!storage) return true
    const theirs = readStored(storage)
    // Nothing there, this tab's own write come back round, or a copy older
    // than the one it has already taken on: either way, no news.
    if (!theirs) return true
    if (theirs.writer === thisTab() || theirs.revision <= revision) return true

    const merge = mergeLibraries(
      base,
      libraryOf(plannerStore.state).projects,
      theirs.projects,
    )
    if (merge.kind === 'conflict') {
      incoming = theirs
      plannerStore.actions.setConflict({ plans: merge.plans })
      return false
    }
    accept(theirs, merge.projects)
    return true
  }

  /** Put the library down, having already looked at what is there. */
  const persist = (): void => {
    clearTimeout(timer)
    timer = undefined
    if (pending === null) return

    const state = plannerStore.state
    const written = persistedOf(state)
    if (!storage) {
      plannerStore.actions.setPersistence({
        status: 'error',
        failure: 'blocked',
      })
      return
    }
    const { projects } = libraryOf(state)
    const next = revision + 1
    try {
      // A library that says exactly what storage already says is not written
      // again. Two tabs each taking on the other's merge would otherwise stamp
      // the same plans back and forth between them for ever.
      if (!sameLibrary(projects, base)) {
        storage.setItem(
          LIBRARY_KEY,
          JSON.stringify({
            version: 1,
            projects,
            writer: thisTab(),
            revision: next,
          }),
        )
        base = projects
        revision = next
      }
      storage.setItem(
        PREFS_KEY,
        JSON.stringify({
          version: 1,
          units: state.units,
          collide: state.collide,
          ...(state.customFurniturePresets.length === 0
            ? {}
            : { customFurniturePresets: state.customFurniturePresets }),
        }),
      )
    } catch (error) {
      // Left pending on purpose: the edit is still only in memory, and the
      // status has to go on saying so until a write of it gets through.
      plannerStore.actions.setPersistence({
        status: 'error',
        failure: failureOf(error),
      })
      return
    }
    saved = written
    pending = null
    plannerStore.actions.setPersistence({ status: 'saved', failure: null })
  }

  const write = (): void => {
    clearTimeout(timer)
    timer = undefined
    if (pending === null) return
    // Another tab may have written since this change was made, and its work is
    // not something to go over on the way past.
    if (!catchUp()) return
    persist()
  }

  /**
   * Settle a clash the reader has now looked at. Either way their copy is what
   * storage holds and so what this tab is now working from; the difference is
   * only whether what is on the canvas is written over it or thrown away.
   */
  const resolve = (take: 'mine' | 'theirs'): void => {
    const theirs = incoming
    if (!theirs) return
    incoming = null
    base = theirs.projects
    revision = theirs.revision
    plannerStore.actions.setConflict(null)

    if (take === 'theirs') {
      plannerStore.actions.adoptLibrary({
        version: 1,
        projects: theirs.projects,
      })
      // Nothing of this tab's is left over: what is on the canvas is now what
      // storage holds, down to the plans it never had.
      clearTimeout(timer)
      timer = undefined
      saved = persistedOf(plannerStore.state)
      pending = null
      plannerStore.actions.setPersistence({ status: 'saved', failure: null })
      return
    }
    // Keeping this tab's: what is on the canvas is a change to their copy now,
    // and goes down over it.
    pending ??= persistedOf(plannerStore.state)
    persist()
  }

  const subscription = plannerStore.subscribe(() => {
    const next = persistedOf(plannerStore.state)
    // Already waiting to be written, or already written: either way there is
    // nothing new here. Both guards also catch the store telling us about the
    // status we are ourselves in the middle of setting.
    if (pending !== null && samePersisted(next, pending)) return
    if (pending === null && samePersisted(next, saved)) return

    pending = next
    clearTimeout(timer)
    timer = setTimeout(write, debounceMs)
    // Set last: it comes straight back round to this subscriber, where the
    // pending set just above is what stops it going round again.
    plannerStore.actions.setPersistence({
      status: 'saving',
      failure: plannerStore.state.persistence.failure,
    })
  })

  const flush = () => write()
  /**
   * `pagehide` is the last event a page reliably gets — a tab closed, a
   * navigation away, or a phone putting the browser to sleep — and on mobile
   * a tab may be discarded from hidden without ever firing it.
   */
  const onHidden = () => {
    const doc = (globalThis as Partial<typeof globalThis>).document
    if (doc?.visibilityState === 'hidden') flush()
  }
  /**
   * Another tab has written to this browser's storage. Which key it wrote is
   * in the event, but not dependably enough to lean on — a store cleared
   * wholesale names none — so anything that might be the library is reason
   * enough to go and look.
   */
  const onStorage = (event: Event) => {
    const key = (event as { key?: string | null }).key
    if (key !== undefined && key !== null && key !== LIBRARY_KEY) return
    catchUp()
  }
  lifecycle?.addEventListener('pagehide', flush)
  lifecycle?.addEventListener('visibilitychange', onHidden)
  lifecycle?.addEventListener('storage', onStorage)

  autosave = { flush, resolve }

  return () => {
    clearTimeout(timer)
    subscription.unsubscribe()
    lifecycle?.removeEventListener('pagehide', flush)
    lifecycle?.removeEventListener('visibilitychange', onHidden)
    lifecycle?.removeEventListener('storage', onStorage)
    if (autosave?.flush === flush) autosave = null
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
  const storage = browserStorage()
  // Subscribed before anything is read rather than after, so that what the
  // read makes of what it found is written straight back down. A plan carried
  // over from before there were projects is given an id on the way in, and an
  // id is what its URL is: it had better be the same one next time.
  startAutosave({ storage })
  // A browser that will not hold anything is worth saying so about before the
  // first edit is made rather than after it is lost.
  if (!storage) {
    plannerStore.actions.setPersistence({
      status: 'error',
      failure: 'blocked',
    })
  }
  plannerStore.actions.loadLibrary(
    readLibrary(storage) ?? { version: 1, projects: [] },
  )
  const prefs = readPrefs(storage)
  if (prefs) {
    plannerStore.actions.setUnits(prefs.units)
    plannerStore.actions.setCollide(prefs.collide)
    plannerStore.actions.setCustomFurniturePresets(prefs.customFurniturePresets)
  }
}
