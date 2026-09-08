import { createStore } from '@tanstack/store'

import { DEFAULT_ROOM, FURNITURE_PRESETS } from './presets.ts'
import { closingIssue, draftPoints, straightPoint } from './drawing.ts'
import {
  DEFAULT_CLOSET,
  closetSize,
  heldClosets,
  placeCloset,
  reattachClosets,
  reflowClosets,
} from './closets.ts'
import {
  clampScale,
  distance,
  fitViewport,
  interiorPoint,
  planBounds,
  drawnWallIssue,
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
  heldOpenings,
  openingInWall,
  openingWall,
  reattachOpenings,
  roomWallAt,
} from './openings.ts'
import {
  blockersFor,
  fits,
  settleFurniture,
  settleFurnitureDrop,
} from './collision.ts'
import { describeAIPlan, layoutBounds, placeRooms } from './aiPlan.ts'
import { enclosureName, enclosureWalls, freeEnclosures } from './enclosures.ts'
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
import { editConnectedWall, openOutline, wallFullyOpen } from './walls.ts'
import {
  DEFAULT_SCALE,
  LibrarySchema,
  MIN_SIZE,
  PlanSchema,
  PrefsSchema,
  ProjectNameSchema,
  StoredLibrarySchema,
} from './types.ts'

import type { AIPlanImport } from './aiPlan.ts'
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
  Space,
  StyleBrush,
  Tool,
  Units,
  Viewport,
  WallDraft,
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
  /**
   * Names and colours put on the spaces the walls close in that were not drawn
   * as rooms of their own. The spaces themselves are not in here: they are
   * worked out from the walls, by `enclosures.ts`, whenever they are wanted.
   */
  spaces: Array<Space>
  selection: Selection
  /** The name currently being typed over on the plan, if any. */
  renaming: Rename
  /** What was last copied, waiting to be put down again. */
  clipboard: Clipboard | null
  /** The colour picked up off one item, waiting to be painted onto others. */
  brush: StyleBrush | null
  tool: Tool
  /** What the opening tool is about to place. */
  openingKind: OpeningKind
  snap: boolean
  straightWalls: boolean
  /** Whether furniture is held out of the walls and out of each other. */
  collide: boolean
  /** Canvas visibility only; furniture stays in the plan. */
  showFurniture: boolean
  /** Display only: the plan itself is always stored in centimetres. */
  units: Units
  viewport: Viewport
  /** The first mark or the saved wall end currently being extended. */
  draft: WallDraft | null
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
  spaces: [],
  selection: null,
  renaming: null,
  clipboard: null,
  brush: null,
  tool: 'select',
  openingKind: 'door',
  snap: true,
  straightWalls: false,
  collide: true,
  showFurniture: true,
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
  // A room lands unlocked: it has just been drawn, and what usually follows is
  // putting it where it belongs. The inspector's padlock holds it once it is
  // there.
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
  const rooms = reattachClosets(
    state.rooms.map((r) => (r.id === room.id ? { ...r, points } : r)),
    room.id,
    room.points,
    points,
    room.closed !== false,
  )
  const openings = reattachOpenings(
    state.openings,
    room.id,
    room.points,
    points,
    room.closed !== false,
  )
  return {
    ...state,
    ...flowedClosets(rooms, openings),
  }
}

/**
 * Take a wall out of the run it was drawn as part of.
 *
 * Only a run has a wall to give up. A room is a closed outline, and taking a
 * wall out of it would leave it neither closed nor a room — so a room is asked
 * to become its walls first, which is a step the reader takes rather than one
 * taken quietly under them, and then any of those walls can go.
 */
function withoutWall(
  state: PlannerState,
  roomId: string,
  index: number,
): { state: PlannerState; error: string | null } {
  const room = state.rooms.find((candidate) => candidate.id === roomId)
  if (!room) return { state, error: 'This room no longer exists.' }
  if (room.kind === 'closet') {
    return {
      state,
      error: 'A closet keeps its four walls; resize it instead.',
    }
  }
  if (room.locked) {
    return { state, error: `Unlock ${room.name} to remove its walls.` }
  }
  if (room.closed === false) {
    if (!roomWallAt(room, index))
      return { state, error: 'This wall no longer exists.' }
    // Removing a middle wall leaves two independent, resumable runs.
    const parts = [
      room.points.slice(0, index + 1),
      room.points.slice(index + 1),
    ]
      .map((points, part) => ({ points, offset: part === 0 ? 0 : index + 1 }))
      .filter((part) => part.points.length >= 2)
      .map((part, i) => ({
        ...part,
        room: { ...room, id: i === 0 ? room.id : newId(), points: part.points },
      }))
    const movedAttachment = (wall: number) =>
      parts.find(
        (part) =>
          wall >= part.offset && wall < part.offset + part.points.length - 1,
      )
    const removedClosets = new Set(
      state.rooms
        .filter(
          (r) => r.attachment?.roomId === roomId && r.attachment.wall === index,
        )
        .map((r) => r.id),
    )
    const rooms = state.rooms
      .filter((r) => r.id !== roomId && !removedClosets.has(r.id))
      .map((r) => {
        if (r.attachment?.roomId !== roomId) return r
        const part = movedAttachment(r.attachment.wall)
        return part
          ? {
              ...r,
              attachment: {
                ...r.attachment,
                roomId: part.room.id,
                wall: r.attachment.wall - part.offset,
              },
            }
          : r
      })
    const openings = state.openings
      .filter((o) => !removedClosets.has(o.roomId))
      .flatMap((o) => {
        if (o.roomId !== roomId) return [o]
        const part = movedAttachment(o.wall)
        return part
          ? [{ ...o, roomId: part.room.id, wall: o.wall - part.offset }]
          : []
      })
    return {
      state: {
        ...state,
        history: commit(state, null, 'Removed a wall'),
        rooms: [...rooms, ...parts.map((part) => part.room)],
        openings,
        draft: null,
        tool: 'select',
        selection: parts.length ? { type: 'room', id: parts[0].room.id } : null,
      },
      error: null,
    }
  }
  if (!roomWallAt(room, index)) {
    return { state, error: 'This wall no longer exists.' }
  }
  return {
    state,
    error: `Convert ${room.name} to walls to take one of them out.`,
  }
}

/**
 * Settle the plan after one room has been reshaped. Everything hanging on the
 * walls that moved holds the place it was put — a room made bigger grows
 * around its doors, windows and closets instead of dragging them along — and
 * the closets are then laid back out from where they now stand.
 */
function heldPlan(
  state: PlannerState,
  roomId: string,
  before: Array<Point>,
  rooms: Array<Room>,
): { rooms: Array<Room>; openings: Array<Opening> } {
  const moved = new Map([[roomId, before]])
  return flowedClosets(
    heldClosets(rooms, moved),
    heldOpenings(state.openings, moved, rooms),
  )
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
 * Where a piece of furniture asked to stand at `to` actually ends up. Exact
 * edits, handles and arrow keys come through here. A pointer drag is previewed
 * freely and uses the same collision rule only when it is dropped.
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
    draft: null,
    rect: null,
    brush: null,
    renaming: null,
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

/**
 * The lowest `<word> n` nothing on the plan is already called.
 *
 * Counted up from one rather than off the length of anything, because the
 * thing being named is sometimes already in the list it is being counted
 * against and sometimes not, and a name that is right either way is worth more
 * than one that never repeats a number.
 */
function freeNames(
  state: PlannerState,
  word: string,
  count: number,
): Array<string> {
  const taken = new Set([
    ...state.rooms.map((room) => room.name),
    ...state.spaces.map((space) => space.name),
  ])
  const names: Array<string> = []
  for (let n = 1; names.length < count; n++) {
    if (!taken.has(`${word} ${n}`)) names.push(`${word} ${n}`)
  }
  return names
}

function freeName(state: PlannerState, word: string): string {
  return freeNames(state, word, 1)[0]
}

/**
 * The next `Room n` free on the plan, counting the rooms that were drawn as
 * rooms and the spaces that were only ever walled in.
 */
function nextRoomName(state: PlannerState): string {
  return freeName(state, 'Room')
}

/**
 * What a run of walls is called before it is anything else.
 *
 * A run of walls is not a room, and calling it one was the editor confusing
 * how a room is usually entered with what a room is. It is walls: they may
 * close a room, they may close three rooms with the walls already standing
 * around them, or they may close nothing at all and simply be a wall. Which of
 * those they turn out to be is read off the plan rather than off their name.
 */
function nextRunName(state: PlannerState): string {
  return freeName(state, 'Walls')
}

/** The same, for a room coming apart into more runs of walls than one. */
function nextRunNames(state: PlannerState, count: number): Array<string> {
  return freeNames(state, 'Walls', count)
}

/** Whether a name is one the editor gave a run rather than one anybody chose. */
const AUTO_RUN_NAME = /^Walls \d+$/

/**
 * Put a name or a colour on one of the spaces the walls close in, adding the
 * record that holds it if this is the first thing said about that space.
 *
 * The point the record is held against is refreshed to the middle of the space
 * as it now stands, every time. That is what keeps a name on a space through a
 * wall being dragged about: each edit re-anchors it where there is the most
 * room to spare, rather than leaving it against wherever it was first put.
 */
function withSpace(
  state: PlannerState,
  key: string,
  patch: { name?: string; color?: string | undefined },
): PlannerState | null {
  const enclosure = freeEnclosures(state.rooms, state.spaces).find(
    (found) => found.key === key,
  )
  if (!enclosure) return null
  const held = enclosure.space
  const label = held
    ? patch.name !== undefined
      ? `Renamed ${held.name}`
      : `Recoloured ${held.name}`
    : patch.name !== undefined
      ? `Named ${patch.name}`
      : `Coloured ${nextRoomName(state)}`
  const spaces = held
    ? state.spaces.map((space) =>
        space.id === held.id
          ? { ...space, ...patch, seed: enclosure.centre }
          : space,
      )
    : [
        ...state.spaces,
        {
          id: newId(),
          name: patch.name ?? nextRoomName(state),
          ...(patch.color ? { color: patch.color } : {}),
          seed: enclosure.centre,
        },
      ]
  return {
    ...state,
    history: commit(state, patchLabel('space', key, patch), label),
    spaces,
  }
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
      color: clipboard.room.color,
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
  const wall = room && roomWallAt(room, source.wall)
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
            spaces: state.spaces,
          }
        : p,
    ),
  }
}

/** A plan with nothing on it: what the editor shows when the URL names none. */
const NO_PLAN = { rooms: [], furniture: [], openings: [], spaces: [] }

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
    spaces: plan.spaces,
    selection: null,
    renaming: null,
    draft: null,
    rect: null,
    brush: null,
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
    spaces: [],
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
      // Reaching for another tool is putting down whatever was in hand.
      brush: null,
    }))
  },

  toggleSnap() {
    setState((s) => ({ ...s, snap: !s.snap }))
  },

  setStraightWalls(straightWalls: boolean) {
    setState((s) => ({ ...s, straightWalls }))
  },

  toggleCollide() {
    setState((s) => ({ ...s, collide: !s.collide }))
  },

  setShowFurniture(showFurniture: boolean) {
    setState((s) => ({
      ...s,
      showFurniture,
      selection:
        !showFurniture && s.selection?.type === 'furniture'
          ? null
          : s.selection,
      renaming:
        !showFurniture && s.renaming?.type === 'furniture' ? null : s.renaming,
      brush: showFurniture ? s.brush : null,
    }))
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
  beginRename(type: 'room' | 'furniture' | 'enclosure', id: string) {
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

  /**
   * Add a whole researched import — any number of rooms, any number of
   * measured footprints — as one step.
   *
   * It is one step because it was one paste: undoing an import the reader did
   * not want should not mean pressing undo once per room. The layout arrives
   * in coordinates of its own, and is dropped over the middle of the view so
   * that what was just added is what is on screen. Furniture lands inside the
   * first imported room when there is one, which is where a plan drawn from a
   * single description belongs.
   */
  addPlanImport(plan: AIPlanImport) {
    setState((s) => {
      if (plan.rooms.length === 0 && plan.furniture.length === 0) return s

      const placements = placeRooms(plan.rooms)
      const span = layoutBounds(placements)
      const centre = snapPoint(viewCentre(s), activeSnapStep(s))
      const origin = {
        x: centre.x - span.x - span.w / 2,
        y: centre.y - span.y - span.h / 2,
      }

      const roomNames = s.rooms.map((room) => room.name)
      const rooms = placements.map(({ room, rect }) => {
        const name = roomNames.includes(room.name)
          ? copyName(room.name, roomNames)
          : room.name
        roomNames.push(name)
        const corner = { x: origin.x + rect.x, y: origin.y + rect.y }
        return {
          id: newId(),
          name,
          points: rectPolygon(corner, {
            x: corner.x + rect.w,
            y: corner.y + rect.h,
          }),
        } satisfies Room
      })

      // Furniture goes into the first room of the import when there is one,
      // which is where a plan described in one breath means it to stand.
      const target =
        placements.length > 0
          ? {
              x: origin.x + placements[0].rect.x + placements[0].rect.w / 2,
              y: origin.y + placements[0].rect.y + placements[0].rect.h / 2,
            }
          : centre

      let next: PlannerState = { ...s, rooms: [...s.rooms, ...rooms] }
      let lastItem: string | null = null
      for (const item of plan.furniture) {
        const taken = next.furniture.map((f) => f.name)
        const shape = {
          id: newId(),
          kind: item.kind,
          name: taken.includes(item.name)
            ? copyName(item.name, taken)
            : item.name,
          w: item.w,
          h: item.h,
          collides: item.collides,
          rotation: 0,
        }
        const dropped: Furniture = {
          ...shape,
          ...freeSpot(next, shape, target),
        }
        next = { ...next, furniture: [...next.furniture, dropped] }
        lastItem = dropped.id
      }

      const lastRoom = rooms[rooms.length - 1]
      const selection: Selection = lastItem
        ? { type: 'furniture', id: lastItem }
        : { type: 'room', id: lastRoom.id }

      return {
        ...next,
        history: commit(s, null, `Added ${describeAIPlan(plan)}`),
        draft: null,
        rect: null,
        tool: 'select',
        selection,
      }
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
    const frame = host && roomWallAt(host, wall)
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
    const opening = openingInWall(roomWallAt(closet, 0)!, {
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
      const frame = host && roomWallAt(host, attachment.wall)
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
    const frame = roomWallAt(room, wall)
    if (!frame) return
    // A door or window cannot hang in an edge that has no wall left.
    if (wallFullyOpen(state.rooms, state.openings, roomId, wall)) return
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

  /**
   * Pick one item's colour up to be put down on others.
   *
   * `sticky` is the brush kept in hand: without it the first item painted
   * spends it, which is what a single tap of a format painter does. The tool
   * comes back to select in the same move, because furniture is what the brush
   * is put down on and none of it is clickable under a drawing tool.
   */
  pickUpStyle(itemId: string, sticky = false) {
    setState((s) => {
      const item = s.furniture.find((f) => f.id === itemId)
      if (!item) return s
      return { ...s, tool: 'select', brush: { color: item.color, sticky } }
    })
  },

  /** Put the brush down again, with or without having painted anything. */
  dropStyle() {
    setState((s) => (s.brush === null ? s : { ...s, brush: null }))
  },

  /**
   * Put the brush's colour on one item, and nothing else about it.
   *
   * The selection stays where it is: the panel goes on describing the item the
   * colour was taken from, which is what says what the brush is still holding.
   * Each item painted is a step of its own to undo — a run of them is a run of
   * separate choices, not one gesture the way a drag is.
   */
  paintFurniture(id: string) {
    setState((s) => {
      const brush = s.brush
      const item = s.furniture.find((f) => f.id === id)
      if (!brush || !item) return s
      // A sticky brush stays in hand; a tapped one is spent on this item,
      // whether or not the item had anything to change.
      const left = brush.sticky ? brush : null
      if (item.color === brush.color) return { ...s, brush: left }
      const patch = { color: brush.color }
      return {
        ...s,
        history: commit(s, null, describeFurniture(item, patch)),
        furniture: s.furniture.map((f) =>
          f.id === id ? { ...f, ...patch } : f,
        ),
        brush: left,
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

  /**
   * Follow the pointer without collision constraints. The history entry still
   * starts here so the whole gesture remains one undoable move.
   */
  previewFurnitureMove(id: string, x: number, y: number) {
    setState((s) => {
      const current = s.furniture.find((f) => f.id === id)
      if (!current) return s
      const patch = { x, y }
      return {
        ...s,
        history: commit(
          s,
          patchLabel('furniture', id, patch),
          describeFurniture(current, patch),
        ),
        furniture: s.furniture.map((f) =>
          f.id === id ? { ...f, ...patch } : f,
        ),
      }
    })
  },

  /**
   * Follow the rotate handle without resolving collisions until it is released.
   * This lets the pointer finish the turn before the final footprint is tested.
   */
  previewFurnitureRotation(id: string, rotation: number) {
    setState((s) => {
      const current = s.furniture.find((f) => f.id === id)
      if (!current) return s
      const patch = { rotation }
      return {
        ...s,
        history: commit(
          s,
          patchLabel('furniture', id, patch),
          describeFurniture(current, patch),
        ),
        furniture: s.furniture.map((f) =>
          f.id === id ? { ...f, ...patch } : f,
        ),
      }
    })
  },

  /**
   * Resolve an overlapping pointer move or turn. A clear final footprint stays
   * exactly where the pointer put it, even when the gesture crossed another
   * object on its way there; an occupied one rests at the nearest clear result
   * found by looking back through the gesture.
   */
  finishFurnitureTransform(id: string, origin: Furniture) {
    setState((s) => {
      const current = s.furniture.find((f) => f.id === id)
      if (
        !current ||
        !s.collide ||
        current.collides === false ||
        fits(current, inTheWayOf(s, id), 0)
      )
        return s
      const settled = settleFurnitureDrop(origin, current, inTheWayOf(s, id))
      return {
        ...s,
        furniture: s.furniture.map((f) => (f.id === id ? settled : f)),
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
        ? heldPlan(s, id, current.points, rooms)
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

  /**
   * Let a room go back to being the walls it was drawn as.
   *
   * Nothing about the drawing changes, and that is the point: the same walls
   * stand in the same places, with the same doors and windows cut through
   * them, and the same floor between them. What is given up is the outline —
   * the one object that could be dragged, resized, rotated and turned round as
   * a piece. Afterwards there are only walls, each to be pushed about on its
   * own, which is what a reader wants the moment a room stops being a rectangle
   * they are moving and becomes walls they are rearranging.
   *
   * The name and the colour do not go with the walls. They belong to the floor,
   * and the floor is still there — the walls close it in exactly as they did —
   * so both are handed to the space the walls now leave between them, anchored
   * on a point inside it. The plan therefore reads the same after this as
   * before it, which is the test of having converted rather than deleted.
   *
   * An edge with nothing left standing in it is not a wall and does not become
   * one: the room is left with the walls it was actually showing, in as many
   * runs as the gaps between them leave. Doors and closets go with the walls
   * they were hanging on, wherever those walls end up — and down with the ones
   * that were never there.
   */
  convertRoomToWalls(id: string): { ok: true } | { ok: false; error: string } {
    let outcome: { ok: true } | { ok: false; error: string } = {
      ok: false,
      error: 'This room could not be converted to walls.',
    }
    setState((s) => {
      const room = s.rooms.find((candidate) => candidate.id === id)
      if (!room) {
        outcome = { ok: false, error: 'This room no longer exists.' }
        return s
      }
      if (room.closed === false) {
        outcome = { ok: false, error: `${room.name} is already walls.` }
        return s
      }
      if (room.kind === 'closet') {
        outcome = {
          ok: false,
          error: 'A closet is a recess in the wall it hangs on, not a room.',
        }
        return s
      }
      if (room.locked) {
        outcome = {
          ok: false,
          error: `Unlock ${room.name} to convert it to walls.`,
        }
        return s
      }

      const outline = openOutline(room.points, (wall) =>
        wallFullyOpen(s.rooms, s.openings, id, wall),
      )
      if (outline.runs.length === 0) {
        outcome = {
          ok: false,
          error: `None of ${room.name}'s walls are there to keep.`,
        }
        return s
      }

      // The first run keeps the room's id, so the plan holds on to a name for
      // what it was; the rest are runs of their own. Only a room walked
      // backwards turns its walls round, and then whatever hangs on one is
      // turned with it: the far end of a wall is its near end once it runs the
      // other way, and a door hinged at one is hinged at the other.
      const names = nextRunNames(s, outline.runs.length)
      const runs = outline.runs.map((run, index) => ({
        walls: run.walls,
        room: {
          ...room,
          id: index === 0 ? room.id : newId(),
          name: names[index],
          color: undefined,
          points: run.points,
          closed: false,
        } satisfies Room,
      }))
      const landed = new Map<number, { roomId: string; wall: number }>()
      for (const run of runs) {
        run.walls.forEach((wall, at) =>
          landed.set(wall, { roomId: run.room.id, wall: at }),
        )
      }
      /** Where what stood at `t` on the room's wall `wall` stands now. */
      const moved = (wall: number, t: number) => {
        const found = landed.get(wall)
        return found && { ...found, t: outline.reversed ? 1 - t : t }
      }

      // A closet on a wall that was never there has nothing left to hang on,
      // and comes down along with whatever was cut into its own walls.
      const felled = new Set<string>()
      const rooms: Array<Room> = []
      for (const candidate of s.rooms) {
        if (candidate.id === id) continue
        const attachment = candidate.attachment
        if (attachment?.roomId !== id) {
          rooms.push(candidate)
          continue
        }
        const to = moved(attachment.wall, attachment.t)
        if (to)
          rooms.push({ ...candidate, attachment: { ...attachment, ...to } })
        else felled.add(candidate.id)
      }
      rooms.push(...runs.map((run) => run.room))

      const openings: Array<Opening> = []
      for (const opening of s.openings) {
        if (felled.has(opening.roomId)) continue
        if (opening.roomId !== id) {
          openings.push(opening)
          continue
        }
        // An opening that took a whole wall out is the reason that wall is not
        // here, and there is nothing left for it to be a hole in.
        const to = moved(opening.wall, opening.t)
        if (!to) continue
        openings.push({
          ...opening,
          ...to,
          hinge: !outline.reversed
            ? opening.hinge
            : opening.hinge === 'start'
              ? 'end'
              : 'start',
        })
      }

      outcome = { ok: true }
      return {
        ...s,
        history: commit(s, null, `Converted ${room.name} to walls`),
        ...flowedClosets(rooms, openings),
        spaces: [
          ...s.spaces,
          {
            id: newId(),
            name: room.name,
            ...(room.color ? { color: room.color } : {}),
            seed: interiorPoint(room.points),
          },
        ],
        selection: { type: 'room', id },
        renaming: null,
      }
    })
    return outcome
  },

  /**
   * Hold a space the walls close in where it is, or let it go again.
   *
   * A space has no outline of its own to hold, so what is held is the walls:
   * the lock goes on to every run that closes the space in, and each of those
   * runs is held whole, wherever else in the plan it goes. That is the only
   * honest way to keep a space's shape, the space being nothing but what those
   * runs leave between them — and it is the same padlock the reader would find
   * by selecting any one of those walls' rooms.
   */
  setEnclosureLocked(key: string, locked: boolean) {
    setState((s) => {
      const enclosure = freeEnclosures(s.rooms, s.spaces).find(
        (found) => found.key === key,
      )
      if (!enclosure) return s
      const held = new Set(
        enclosureWalls(s.rooms, enclosure).map((room) => room.id),
      )
      // Nothing to hold, or nothing that is not held already: either way this
      // is not a change, and must not leave a step to undo.
      const changed = s.rooms.some(
        (room) => held.has(room.id) && (room.locked === true) !== locked,
      )
      if (!changed) return s
      return {
        ...s,
        history: commit(
          s,
          null,
          `${locked ? 'Locked' : 'Unlocked'} ${enclosureName(enclosure)}`,
        ),
        rooms: s.rooms.map((room) =>
          held.has(room.id) ? { ...room, locked } : room,
        ),
      }
    })
  },

  /**
   * Name, or recolour, one of the spaces the walls close in that was never
   * drawn as a room of its own.
   *
   * The space is named by its key rather than by an id, because it has no id:
   * it is worked out from the walls each time they change. A key that no
   * longer answers to a space — because a wall moved between the click and
   * this call — changes nothing, which is the right answer for a space that is
   * no longer there.
   */
  updateEnclosure(key: string, patch: { name?: string; color?: string }) {
    setState((s) => withSpace(s, key, patch) ?? s)
  },

  /** Take the name and the colour back off a space, leaving its walls alone. */
  clearEnclosure(key: string) {
    setState((s) => {
      const enclosure = freeEnclosures(s.rooms, s.spaces).find(
        (found) => found.key === key,
      )
      const held = enclosure?.space
      if (!held) return s
      return {
        ...s,
        history: commit(s, null, `Cleared ${held.name}`),
        spaces: s.spaces.filter((space) => space.id !== held.id),
        renaming: null,
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
        ...heldPlan(s, roomId, room.points, rooms),
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
        ...heldPlan(s, roomId, room.points, rooms),
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
      if (
        !room ||
        room.locked ||
        room.points.length <= (room.closed === false ? 2 : 3)
      )
        return s
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

  /**
   * Take a wall out of a room and close the outline back up behind it, in one
   * history step. A wall that cannot go explains itself and changes nothing.
   */
  removeWall(
    roomId: string,
    index: number,
  ): { ok: true } | { ok: false; error: string } {
    let outcome: { ok: true } | { ok: false; error: string } = {
      ok: false,
      error: 'The wall could not be removed.',
    }
    setState((s) => {
      const { state, error } = withoutWall(s, roomId, index)
      outcome = error === null ? { ok: true } : { ok: false, error }
      return state
    })
    return outcome
  },

  deleteSelected() {
    setState((s) => {
      if (!s.selection) return s
      const { type, id } = s.selection
      // Delete on a held wall takes that wall out of its room, rather than the
      // room the wall belongs to: the selection is the wall, and the room is
      // still reachable by holding the room itself.
      if (type === 'wall') return withoutWall(s, id, s.selection.index).state
      // Nothing on the plan belongs to a space but its name: the walls that
      // close it in were drawn as part of something else, and stay. So delete
      // clears the name, and the space itself goes on being a space.
      if (type === 'enclosure') {
        const held = freeEnclosures(s.rooms, s.spaces).find(
          (found) => found.key === id,
        )?.space
        if (!held) return { ...s, selection: null, renaming: null }
        return {
          ...s,
          history: commit(s, null, `Cleared ${held.name}`),
          spaces: s.spaces.filter((space) => space.id !== held.id),
          renaming: null,
        }
      }
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
      // A space is where its walls are; an arrow key on one would have to
      // choose which of them to push, and there is no answer to that.
      if (type === 'wall' || type === 'enclosure') return s
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
          const wall = host && roomWallAt(host, attachment.wall)
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

  addDraftPoint(point: Point): { ok: true } | { ok: false; error: string } {
    let outcome: { ok: true } | { ok: false; error: string } = { ok: true }
    setState((s) => {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return s
      const points = draftPoints(s.rooms, s.draft)
      if (points.length === 0) {
        return { ...s, draft: { start: point }, selection: null }
      }
      // A double-click or a tap on the active end must not create a tiny wall.
      const last = points[points.length - 1]
      const target = s.straightWalls ? straightPoint(last, point) : point
      if (distance(last, target) < MIN_SIZE) return s
      const next = [...points, target]
      const error = drawnWallIssue(next)
      if (error) {
        outcome = { ok: false, error }
        return s
      }
      const drawing = s.draft!
      if ('start' in drawing) {
        const room: Room = {
          id: newId(),
          name: nextRunName(s),
          points: next,
          closed: false,
          locked: false,
        }
        return {
          ...s,
          history: commit(s, null, 'Drew a wall'),
          rooms: [...s.rooms, room],
          draft: { roomId: room.id, end: 'end' },
          selection: { type: 'wall', id: room.id, index: 0 },
        }
      }
      const prepend = drawing.end === 'start'
      return {
        ...s,
        history: commit(s, null, 'Drew a wall'),
        rooms: s.rooms.map((room) => {
          if (room.id === drawing.roomId)
            return { ...room, points: prepend ? [...next].reverse() : next }
          if (prepend && room.attachment?.roomId === drawing.roomId) {
            return {
              ...room,
              attachment: {
                ...room.attachment,
                wall: room.attachment.wall + 1,
              },
            }
          }
          return room
        }),
        openings: prepend
          ? s.openings.map((opening) =>
              opening.roomId === drawing.roomId
                ? { ...opening, wall: opening.wall + 1 }
                : opening,
            )
          : s.openings,
        selection: {
          type: 'wall',
          id: drawing.roomId,
          index: prepend ? 0 : next.length - 2,
        },
      }
    })
    return outcome
  },

  continueWalls(roomId: string, end: 'start' | 'end' = 'end') {
    setState((s) => {
      const room = s.rooms.find((candidate) => candidate.id === roomId)
      if (!room || room.closed !== false || room.locked) return s
      return {
        ...s,
        tool: 'room',
        draft: { roomId, end },
        rect: null,
        renaming: null,
        brush: null,
        selection: {
          type: 'wall',
          id: roomId,
          index: end === 'start' ? 0 : room.points.length - 2,
        },
      }
    })
  },

  popDraftPoint() {
    setState((s) => {
      const drawing = s.draft
      if (!drawing) return s
      if ('start' in drawing) return { ...s, draft: null }
      const room = s.rooms.find((candidate) => candidate.id === drawing.roomId)
      if (!room || room.locked) return s
      const prepend = drawing.end === 'start'
      const points = prepend ? room.points.slice(1) : room.points.slice(0, -1)
      const removed = prepend ? 0 : room.points.length - 2
      const removedRooms = new Set(
        s.rooms
          .filter(
            (r) =>
              r.attachment?.roomId === room.id && r.attachment.wall === removed,
          )
          .map((r) => r.id),
      )
      if (points.length < 2) removedRooms.add(room.id)
      return {
        ...s,
        history: commit(s, null, 'Undid a wall'),
        rooms: s.rooms
          .filter((r) => !removedRooms.has(r.id))
          .map((r) => {
            if (r.id === room.id) return { ...r, points }
            if (prepend && r.attachment?.roomId === room.id) {
              return {
                ...r,
                attachment: { ...r.attachment, wall: r.attachment.wall - 1 },
              }
            }
            return r
          }),
        openings: s.openings
          .filter(
            (opening) =>
              !removedRooms.has(opening.roomId) &&
              !(opening.roomId === room.id && opening.wall === removed),
          )
          .map((opening) =>
            prepend && opening.roomId === room.id
              ? { ...opening, wall: opening.wall - 1 }
              : opening,
          ),
        draft: points.length < 2 ? { start: points[0] } : drawing,
        selection:
          points.length < 2
            ? null
            : {
                type: 'wall',
                id: room.id,
                index: prepend ? 0 : points.length - 2,
              },
      }
    })
  },

  /**
   * Put the pen down, keeping the walls already drawn — and keeping the pen.
   *
   * A run of walls is one run, not one drawing: walls go up all over a plan,
   * in runs that have nothing to do with each other, and having to reach for
   * the tool again between every two of them is the tool arguing with what it
   * is for. So the next click starts the next run wherever it lands, and it is
   * Escape a second time that hands the pen back.
   */
  cancelDraft() {
    setState((s) => ({ ...s, draft: null }))
  },

  /** Closing is explicit. Stopping drawing never invents another wall. */
  commitDraft(): { ok: true } | { ok: false; error: string } {
    let outcome: { ok: true } | { ok: false; error: string } = { ok: true }
    setState((s) => {
      if (!s.draft) return s
      const error = closingIssue(draftPoints(s.rooms, s.draft), s.straightWalls)
      if (error) {
        outcome = { ok: false, error }
        return s
      }
      if ('start' in s.draft) return s
      const id = s.draft.roomId
      return {
        ...s,
        history: commit(s, null, 'Closed a room'),
        // Closed, the run is a room, and takes a room's name — unless somebody
        // had already given it one of their own, which stands.
        rooms: s.rooms.map((room) =>
          room.id === id
            ? {
                ...room,
                name: AUTO_RUN_NAME.test(room.name)
                  ? nextRoomName(s)
                  : room.name,
                closed: undefined,
              }
            : room,
        ),
        draft: null,
        tool: 'select',
        selection: { type: 'room', id },
      }
    })
    return outcome
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
    return room !== undefined && roomWallAt(room, o.wall) !== null
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
    spaces: parsed.data.spaces,
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
    state.spaces,
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
