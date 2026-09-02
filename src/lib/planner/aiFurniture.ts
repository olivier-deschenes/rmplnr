import { z } from 'zod'

import { FurnitureKindSchema, MIN_SIZE } from './types.ts'

import type { FurnitureKind } from './types.ts'

const MAX_PASTE_LENGTH = 20 * 1024
const MAX_FURNITURE_SIZE = 10_000
const MAX_FURNITURE_SIZE_LABEL = '10,000'
const JSON_FENCE = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i

const AIFurnitureResponseSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1, 'Enter the product name.')
    .max(80, 'Use a product name no longer than 80 characters.'),
  kind: FurnitureKindSchema,
  widthCm: z
    .number()
    .min(MIN_SIZE, `Width must be at least ${MIN_SIZE} cm.`)
    .max(
      MAX_FURNITURE_SIZE,
      `Width must be no more than ${MAX_FURNITURE_SIZE_LABEL} cm.`,
    ),
  depthCm: z
    .number()
    .min(MIN_SIZE, `Depth must be at least ${MIN_SIZE} cm.`)
    .max(
      MAX_FURNITURE_SIZE,
      `Depth must be no more than ${MAX_FURNITURE_SIZE_LABEL} cm.`,
    ),
  collides: z.boolean().optional(),
  sourceUrl: z.httpUrl('Use a complete HTTP or HTTPS source URL.').optional(),
})

export type AIFurnitureImport = {
  name: string
  kind: FurnitureKind
  w: number
  h: number
  collides: boolean
  sourceUrl?: string
}

export const AI_FURNITURE_PROMPT = [
  'Help me add one real product to rmplnr, a 2D floor planner.',
  "After I name it, research the exact assembled model and variant's exterior width and depth. Prefer manufacturer specs. Ask me to clarify missing details; do not guess.",
  "Return the top-down floor footprint in centimetres. Depth means front-to-back; never use package dimensions or the product's physical height.",
  `Use exactly one of these kinds: ${FurnitureKindSchema.options.join(', ')}. Use box when none is a good match.`,
  'Set collides to false only for a soft floor covering, such as a rug; otherwise use true.',
  'Include sourceUrl only for a reliable HTTP or HTTPS page that supports the dimensions.',
  `Only return dimensions from ${MIN_SIZE} to ${MAX_FURNITURE_SIZE_LABEL} cm; otherwise say the product cannot be imported.`,
  'For an importable product, return exactly one JSON object with these keys and no others:',
  '{"name":"Product name and variant","kind":"box","widthCm":100,"depthCm":50,"collides":true,"sourceUrl":"https://manufacturer.example/product"}',
  'Return JSON only, with no Markdown fence, explanation, citations, or extra text.',
  'I have not named the product yet. First, ask only for its name, exact model, or URL. Do not return the example JSON yet.',
].join('\n\n')

export class AIFurnitureImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AIFurnitureImportError'
  }
}

function jsonText(contents: string): string {
  if (contents.length > MAX_PASTE_LENGTH) {
    throw new AIFurnitureImportError(
      'The pasted response is too long. Paste one JSON object under 20 KiB.',
    )
  }

  const trimmed = contents.trim()
  if (!trimmed) {
    throw new AIFurnitureImportError('Paste the furniture JSON first.')
  }
  if (!trimmed.startsWith('```')) return trimmed

  const fenced = JSON_FENCE.exec(trimmed)
  if (!fenced) {
    throw new AIFurnitureImportError(
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

/** Validate one AI response and turn its floor footprint into planner fields. */
export function parseAIFurniture(contents: string): AIFurnitureImport {
  let value: unknown
  try {
    value = JSON.parse(jsonText(contents))
  } catch (problem) {
    if (problem instanceof AIFurnitureImportError) throw problem
    throw new AIFurnitureImportError(
      'The pasted response is not valid JSON. Paste only one JSON object.',
    )
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AIFurnitureImportError(
      'The pasted response must be one JSON object, not a list or value.',
    )
  }

  const parsed = AIFurnitureResponseSchema.safeParse(value)
  if (!parsed.success) {
    throw new AIFurnitureImportError(
      `This furniture JSON cannot be added. ${validationDetail(parsed.error)}`,
    )
  }

  const { name, kind, widthCm, depthCm, sourceUrl } = parsed.data
  return {
    name,
    kind,
    w: widthCm,
    h: depthCm,
    collides: parsed.data.collides ?? kind !== 'rug',
    ...(sourceUrl ? { sourceUrl } : {}),
  }
}
