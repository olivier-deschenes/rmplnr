import { describe, expect, it } from 'bun:test'

import {
  AI_FURNITURE_PROMPT,
  AIFurnitureImportError,
  parseAIFurniture,
} from './aiFurniture.ts'
import { FurnitureKindSchema, MIN_SIZE } from './types.ts'

const response = {
  name: 'IKEA KIVIK 3-seat sofa',
  kind: 'sofa',
  widthCm: 228,
  depthCm: 95.5,
  collides: true,
  sourceUrl: 'https://www.ikea.com/example',
} as const

function json(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...response, ...overrides })
}

describe('AI_FURNITURE_PROMPT', () => {
  it('lists every kind accepted by the parser', () => {
    for (const kind of FurnitureKindSchema.options) {
      expect(AI_FURNITURE_PROMPT).toContain(kind)
    }
  })

  it('describes the research, unit, footprint, fallback, and output contract', () => {
    expect(AI_FURNITURE_PROMPT).toContain('manufacturer specs')
    expect(AI_FURNITURE_PROMPT).toContain('Ask me to clarify')
    expect(AI_FURNITURE_PROMPT).toContain('centimetres')
    expect(AI_FURNITURE_PROMPT).toContain('top-down floor footprint')
    expect(AI_FURNITURE_PROMPT).toContain('physical height')
    expect(AI_FURNITURE_PROMPT).toContain('Use box')
    expect(AI_FURNITURE_PROMPT).toContain('sourceUrl')
    expect(AI_FURNITURE_PROMPT).toContain('from 5 to 10,000 cm')
    expect(AI_FURNITURE_PROMPT).toContain('I have not named the product')
    expect(AI_FURNITURE_PROMPT).toContain('ask only for its name')
    expect(AI_FURNITURE_PROMPT).toContain('Return JSON only')
    expect(AI_FURNITURE_PROMPT).toContain('Do not return the example JSON yet')
    expect(encodeURIComponent(AI_FURNITURE_PROMPT).length).toBeLessThan(1800)
  })
})

describe('parseAIFurniture', () => {
  it('maps an exact raw response onto the internal floor footprint', () => {
    expect(parseAIFurniture(json())).toEqual({
      name: response.name,
      kind: response.kind,
      w: response.widthCm,
      h: response.depthCm,
      collides: true,
      sourceUrl: response.sourceUrl,
    })
  })

  it('accepts one surrounding JSON or plain code fence', () => {
    expect(parseAIFurniture(`\n\`\`\`json\n${json()}\n\`\`\`\n`)).toEqual(
      parseAIFurniture(json()),
    )
    expect(parseAIFurniture(`\`\`\`\r\n${json()}\r\n\`\`\``)).toEqual(
      parseAIFurniture(json()),
    )
  })

  it('trims the name and keeps dimensions at the minimum size', () => {
    expect(
      parseAIFurniture(
        json({ name: '  Slim shelf  ', widthCm: MIN_SIZE, depthCm: MIN_SIZE }),
      ),
    ).toMatchObject({ name: 'Slim shelf', w: MIN_SIZE, h: MIN_SIZE })
  })

  it('defaults solidity from the kind without overriding an explicit value', () => {
    const { collides: _collides, ...withoutCollides } = response

    expect(
      parseAIFurniture(JSON.stringify({ ...withoutCollides, kind: 'rug' }))
        .collides,
    ).toBe(false)
    expect(parseAIFurniture(JSON.stringify(withoutCollides)).collides).toBe(
      true,
    )
    expect(
      parseAIFurniture(json({ kind: 'rug', collides: true })).collides,
    ).toBe(true)
    expect(parseAIFurniture(json({ collides: false })).collides).toBe(false)
  })

  it('allows sourceUrl to be omitted and accepts only HTTP(S) sources', () => {
    const { sourceUrl: _sourceUrl, ...withoutSource } = response
    expect(parseAIFurniture(JSON.stringify(withoutSource))).not.toHaveProperty(
      'sourceUrl',
    )
    expect(
      parseAIFurniture(json({ sourceUrl: 'http://example.com/spec' })),
    ).toHaveProperty('sourceUrl', 'http://example.com/spec')

    for (const sourceUrl of [
      'ftp://example.com/spec',
      'example.com/spec',
      '/spec',
      '',
    ]) {
      expect(() => parseAIFurniture(json({ sourceUrl }))).toThrow('sourceUrl')
    }
  })

  it('rejects malformed, empty, prose-wrapped, or multiply fenced text', () => {
    expect(() => parseAIFurniture('')).toThrow('Paste the furniture JSON first')
    expect(() => parseAIFurniture('{')).toThrow('not valid JSON')
    expect(() => parseAIFurniture(`Here it is:\n${json()}`)).toThrow(
      'not valid JSON',
    )
    expect(() =>
      parseAIFurniture(`\`\`\`json\n${json()}\n\`\`\`\nMore text`),
    ).toThrow('no text outside')
    expect(() =>
      parseAIFurniture(
        `\`\`\`json\n${json()}\n\`\`\`\n\`\`\`json\n${json()}\n\`\`\``,
      ),
    ).toThrow()
  })

  it('rejects roots other than one object', () => {
    for (const value of [[], [response], null, 'furniture', 1, true]) {
      expect(() => parseAIFurniture(JSON.stringify(value))).toThrow(
        'must be one JSON object',
      )
    }
  })

  it('rejects unknown fields instead of silently importing the wrong shape', () => {
    for (const field of ['heightCm', 'id', 'x', 'rotation']) {
      expect(() => parseAIFurniture(json({ [field]: 10 }))).toThrow(field)
    }
  })

  it('rejects missing or invalid names', () => {
    expect(() => parseAIFurniture(json({ name: '   ' }))).toThrow('name')
    expect(() => parseAIFurniture(json({ name: 'x'.repeat(81) }))).toThrow(
      'name',
    )
    expect(() => parseAIFurniture(json({ name: 12 }))).toThrow('name')
  })

  it('rejects unknown or differently cased kinds', () => {
    for (const kind of ['cabinet', 'Sofa', '']) {
      expect(() => parseAIFurniture(json({ kind }))).toThrow('kind')
    }
  })

  it('rejects missing, non-numeric, non-finite, and undersized dimensions', () => {
    const { widthCm: _widthCm, ...withoutWidth } = response
    expect(() => parseAIFurniture(JSON.stringify(withoutWidth))).toThrow(
      'widthCm',
    )

    for (const [field, value] of [
      ['widthCm', '228'],
      ['widthCm', 0],
      ['widthCm', -1],
      ['widthCm', MIN_SIZE - 0.01],
      ['depthCm', null],
      ['depthCm', 0],
    ] as const) {
      expect(() => parseAIFurniture(json({ [field]: value }))).toThrow(field)
    }

    expect(() => parseAIFurniture(json().replace('95.5', '1e999'))).toThrow(
      'depthCm',
    )
  })

  it('rejects dimensions too large for useful planner geometry', () => {
    expect(() => parseAIFurniture(json({ widthCm: 10_001 }))).toThrow('widthCm')
    expect(() => parseAIFurniture(json({ depthCm: 10_001 }))).toThrow('depthCm')
  })

  it('rejects an invalid collides value', () => {
    expect(() => parseAIFurniture(json({ collides: 'true' }))).toThrow(
      'collides',
    )
  })

  it('rejects pasted responses larger than 20 KiB before parsing', () => {
    expect(() => parseAIFurniture('x'.repeat(20 * 1024 + 1))).toThrow(
      'under 20 KiB',
    )
  })

  it('uses its own user-facing error type', () => {
    expect(() => parseAIFurniture('{')).toThrow(AIFurnitureImportError)
  })
})
