import { z } from 'zod'

import { FurnitureKindSchema, MIN_SIZE } from './types.ts'

import type { FurnitureKind, Rect } from './types.ts'

const MAX_PASTE_LENGTH = 20 * 1024
const MAX_SIZE = 10_000
const MAX_SIZE_LABEL = '10,000'
/** How far from the layout origin a placed room may be asked to stand. */
const MAX_COORD = 100_000
const MAX_ITEMS = 50
const JSON_FENCE = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i

const dimension = (field: string) =>
  z
    .number()
    .min(MIN_SIZE, `${field} must be at least ${MIN_SIZE} cm.`)
    .max(MAX_SIZE, `${field} must be no more than ${MAX_SIZE_LABEL} cm.`)

const itemName = z
  .string()
  .trim()
  .min(1, 'Enter a name.')
  .max(80, 'Use a name no longer than 80 characters.')

const coordinate = z
  .number()
  .min(-MAX_COORD, 'Keep every room within 100,000 cm of the plan origin.')
  .max(MAX_COORD, 'Keep every room within 100,000 cm of the plan origin.')

/**
 * A rectangular room. Its corner is optional: a response that places every
 * room on one grid is laid out exactly as it drew them, and one that only
 * lists rooms is arranged here instead.
 */
const AIRoomResponseSchema = z.strictObject({
  name: itemName,
  widthCm: dimension('Width'),
  depthCm: dimension('Depth'),
  xCm: coordinate.optional(),
  yCm: coordinate.optional(),
})

const AIFurnitureResponseSchema = z.strictObject({
  name: itemName,
  kind: FurnitureKindSchema,
  widthCm: dimension('Width'),
  depthCm: dimension('Depth'),
  collides: z.boolean().optional(),
  sourceUrl: z.httpUrl('Use a complete HTTP or HTTPS source URL.').optional(),
})

const AIPlanResponseSchema = z.strictObject({
  rooms: z
    .array(AIRoomResponseSchema)
    .max(MAX_ITEMS, `Import no more than ${MAX_ITEMS} rooms at once.`)
    .optional(),
  furniture: z
    .array(AIFurnitureResponseSchema)
    .max(
      MAX_ITEMS,
      `Import no more than ${MAX_ITEMS} pieces of furniture at once.`,
    )
    .optional(),
})

export type AIRoomImport = {
  name: string
  w: number
  h: number
  /** Top-left corner on the response's own grid, when it placed the room. */
  x?: number
  y?: number
}

export type AIFurnitureImport = {
  name: string
  kind: FurnitureKind
  w: number
  h: number
  collides: boolean
  sourceUrl?: string
}

export type AIPlanImport = {
  rooms: Array<AIRoomImport>
  furniture: Array<AIFurnitureImport>
}

export const AI_PLAN_PROMPT = [
  'Help me fill in rmplnr, a 2D floor planner. I will describe rooms, furniture, or both, and you return one JSON object I paste back.',
  "For a real product, research the exact assembled model and variant's exterior width and depth. Prefer manufacturer specs. Ask me to clarify missing details; do not guess.",
  'Every measurement is a top-down floor footprint in centimetres. Depth means front-to-back; never use package dimensions or the physical height.',
  'Rooms are rectangles. Give each room xCm and yCm for its top-left corner on one shared grid, so adjoining rooms touch and no two rooms overlap. Leave both out of every room to have rmplnr arrange them instead.',
  `Use exactly one of these kinds for each piece of furniture: ${FurnitureKindSchema.options.join(', ')}. Use box when none is a good match.`,
  'Set collides to false only for a soft floor covering, such as a rug; otherwise use true.',
  'Include sourceUrl only for a reliable HTTP or HTTPS page that supports the dimensions.',
  `Only return dimensions from ${MIN_SIZE} to ${MAX_SIZE_LABEL} cm; otherwise say the room or product cannot be imported. Return at most ${MAX_ITEMS} rooms and ${MAX_ITEMS} pieces of furniture.`,
  'Return exactly one JSON object with these keys and no others, leaving out either list when it is empty:',
  '{"rooms":[{"name":"Living room","widthCm":450,"depthCm":380,"xCm":0,"yCm":0}],"furniture":[{"name":"Product name and variant","kind":"sofa","widthCm":228,"depthCm":95,"collides":true,"sourceUrl":"https://manufacturer.example/product"}]}',
  'Put the JSON in one ```json code block for easy copying. Return no other text.',
  'I have not described anything yet. First, ask which rooms and which products I want. Do not return the example JSON yet.',
].join('\n\n')

export class AIPlanImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AIPlanImportError'
  }
}

function jsonText(contents: string): string {
  if (contents.length > MAX_PASTE_LENGTH) {
    throw new AIPlanImportError(
      'The pasted response is too long. Paste one JSON object under 20 KiB.',
    )
  }

  const trimmed = contents.trim()
  if (!trimmed) {
    throw new AIPlanImportError('Paste the plan JSON first.')
  }
  if (!trimmed.startsWith('```')) return trimmed

  const fenced = JSON_FENCE.exec(trimmed)
  if (!fenced) {
    throw new AIPlanImportError(
      'Paste one JSON object with no text outside its optional code block.',
    )
  }
  return fenced[1].trim()
}

function validationDetail(error: z.ZodError): string {
  const issue = error.issues[0]
  const path = issue.path.map(String).join('.')
  return path ? `${path}: ${issue.message}` : issue.message
}

function furnitureOf(
  item: z.infer<typeof AIFurnitureResponseSchema>,
): AIFurnitureImport {
  const { name, kind, widthCm, depthCm, sourceUrl } = item
  return {
    name,
    kind,
    w: widthCm,
    h: depthCm,
    collides: item.collides ?? kind !== 'rug',
    ...(sourceUrl ? { sourceUrl } : {}),
  }
}

function roomOf(room: z.infer<typeof AIRoomResponseSchema>): AIRoomImport {
  const { name, widthCm, depthCm, xCm, yCm } = room
  return {
    name,
    w: widthCm,
    h: depthCm,
    ...(xCm !== undefined && yCm !== undefined ? { x: xCm, y: yCm } : {}),
  }
}

/**
 * Validate one AI response and turn it into rooms and floor footprints.
 *
 * A bare furniture object is read as a one-item import, so a conversation
 * started from the older single-product prompt still pastes in.
 */
export function parseAIPlan(contents: string): AIPlanImport {
  let value: unknown
  try {
    value = JSON.parse(jsonText(contents))
  } catch (problem) {
    if (problem instanceof AIPlanImportError) throw problem
    throw new AIPlanImportError(
      'The pasted response is not valid JSON. Paste only one JSON object.',
    )
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AIPlanImportError(
      'The pasted response must be one JSON object, not a list or value.',
    )
  }

  if (!('rooms' in value) && !('furniture' in value)) {
    const single = AIFurnitureResponseSchema.safeParse(value)
    if (!single.success) {
      throw new AIPlanImportError(
        `This plan JSON cannot be added. ${validationDetail(single.error)}`,
      )
    }
    return { rooms: [], furniture: [furnitureOf(single.data)] }
  }

  const parsed = AIPlanResponseSchema.safeParse(value)
  if (!parsed.success) {
    throw new AIPlanImportError(
      `This plan JSON cannot be added. ${validationDetail(parsed.error)}`,
    )
  }

  const rooms = (parsed.data.rooms ?? []).map(roomOf)
  const furniture = (parsed.data.furniture ?? []).map(furnitureOf)
  if (rooms.length === 0 && furniture.length === 0) {
    throw new AIPlanImportError(
      'This plan JSON cannot be added. Include at least one room or one piece of furniture.',
    )
  }
  return { rooms, furniture }
}

function count(n: number, one: string, many: string): string | null {
  return n === 0 ? null : `${n} ${n === 1 ? one : many}`
}

/** What an import added, for the history step and the toast that follows it. */
export function describeAIPlan(plan: AIPlanImport): string {
  const parts = [
    count(plan.rooms.length, 'room', 'rooms'),
    count(plan.furniture.length, 'piece of furniture', 'pieces of furniture'),
  ].filter((part) => part !== null)
  return parts.length === 0 ? 'nothing' : parts.join(' and ')
}

/** Gap left between rooms this file has to arrange itself. */
const AUTO_GAP = 30

/** How wide a row of arranged rooms runs before it wraps onto the next. */
const AUTO_ROW_WIDTH = 1600

/**
 * Where each imported room stands, on a grid whose origin is the layout's own.
 *
 * A response that placed its rooms is trusted with them: that placement is the
 * floor plan, and moving any of it would break the adjacencies it drew. The
 * rest are arranged in wrapped rows below whatever was placed, spaced apart
 * rather than joined, since nothing in the response says which of them share a
 * wall.
 */
export function placeRooms(
  rooms: Array<AIRoomImport>,
): Array<{ room: AIRoomImport; rect: Rect }> {
  const below = rooms.reduce(
    (bottom, room) =>
      room.x === undefined || room.y === undefined
        ? bottom
        : Math.max(bottom, room.y + room.h + AUTO_GAP),
    0,
  )

  let cursorX = 0
  let rowY = below
  let rowDepth = 0

  return rooms.map((room) => {
    if (room.x !== undefined && room.y !== undefined) {
      return { room, rect: { x: room.x, y: room.y, w: room.w, h: room.h } }
    }
    if (cursorX > 0 && cursorX + room.w > AUTO_ROW_WIDTH) {
      cursorX = 0
      rowY += rowDepth + AUTO_GAP
      rowDepth = 0
    }
    const rect = { x: cursorX, y: rowY, w: room.w, h: room.h }
    cursorX += room.w + AUTO_GAP
    rowDepth = Math.max(rowDepth, room.h)
    return { room, rect }
  })
}

/** The box every arranged room fits inside, in the layout's own coordinates. */
export function layoutBounds(placements: Array<{ rect: Rect }>): Rect {
  if (placements.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
  const x = Math.min(...placements.map((p) => p.rect.x))
  const y = Math.min(...placements.map((p) => p.rect.y))
  const right = Math.max(...placements.map((p) => p.rect.x + p.rect.w))
  const bottom = Math.max(...placements.map((p) => p.rect.y + p.rect.h))
  return { x, y, w: right - x, h: bottom - y }
}
