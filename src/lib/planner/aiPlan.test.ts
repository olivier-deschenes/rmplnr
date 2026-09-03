import { describe, expect, it } from 'bun:test'

import {
  AI_PLAN_PROMPT,
  AIPlanImportError,
  describeAIPlan,
  layoutBounds,
  parseAIPlan,
  placeRooms,
} from './aiPlan.ts'
import { FurnitureKindSchema, MIN_SIZE } from './types.ts'

const sofa = {
  name: 'IKEA KIVIK 3-seat sofa',
  kind: 'sofa',
  widthCm: 228,
  depthCm: 95.5,
  collides: true,
  sourceUrl: 'https://www.ikea.com/example',
} as const

const room = {
  name: 'Living room',
  widthCm: 450,
  depthCm: 380,
  xCm: 0,
  yCm: 0,
} as const

function furnitureJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...sofa, ...overrides })
}

function planJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ rooms: [room], furniture: [sofa], ...overrides })
}

describe('AI_PLAN_PROMPT', () => {
  it('lists every furniture kind accepted by the parser', () => {
    for (const kind of FurnitureKindSchema.options) {
      expect(AI_PLAN_PROMPT).toContain(kind)
    }
  })

  it('asks for rooms and furniture in one response', () => {
    expect(AI_PLAN_PROMPT).toContain('rooms, furniture, or both')
    expect(AI_PLAN_PROMPT).toContain('Rooms are rectangles')
    expect(AI_PLAN_PROMPT).toContain('xCm and yCm')
    expect(AI_PLAN_PROMPT).toContain('no two rooms overlap')
    expect(AI_PLAN_PROMPT).toContain('rmplnr arrange them')
    expect(AI_PLAN_PROMPT).toContain('"rooms"')
    expect(AI_PLAN_PROMPT).toContain('"furniture"')
    expect(AI_PLAN_PROMPT).toContain('at most 50 rooms')
  })

  it('describes the research, unit, footprint, fallback, and output contract', () => {
    expect(AI_PLAN_PROMPT).toContain('manufacturer specs')
    expect(AI_PLAN_PROMPT).toContain('Ask me to clarify')
    expect(AI_PLAN_PROMPT).toContain('centimetres')
    expect(AI_PLAN_PROMPT).toContain('top-down floor footprint')
    expect(AI_PLAN_PROMPT).toContain('physical height')
    expect(AI_PLAN_PROMPT).toContain('Use box')
    expect(AI_PLAN_PROMPT).toContain('sourceUrl')
    expect(AI_PLAN_PROMPT).toContain('from 5 to 10,000 cm')
    expect(AI_PLAN_PROMPT).toContain('I have not described anything yet')
    expect(AI_PLAN_PROMPT).toContain('ask which rooms and which products')
    expect(AI_PLAN_PROMPT).toContain('one ```json code block')
    expect(AI_PLAN_PROMPT).toContain('easy copying')
    expect(AI_PLAN_PROMPT).toContain('Do not return the example JSON yet')
    expect(encodeURIComponent(AI_PLAN_PROMPT).length).toBeLessThan(2600)
  })
})

describe('parseAIPlan', () => {
  it('maps rooms and furniture onto internal footprints', () => {
    expect(parseAIPlan(planJson())).toEqual({
      rooms: [
        { name: room.name, w: room.widthCm, h: room.depthCm, x: 0, y: 0 },
      ],
      furniture: [
        {
          name: sofa.name,
          kind: sofa.kind,
          w: sofa.widthCm,
          h: sofa.depthCm,
          collides: true,
          sourceUrl: sofa.sourceUrl,
        },
      ],
    })
  })

  it('accepts many rooms and many pieces of furniture at once', () => {
    const plan = parseAIPlan(
      planJson({
        rooms: [room, { ...room, name: 'Kitchen', xCm: 450 }],
        furniture: [sofa, { ...sofa, name: 'Desk', kind: 'desk' }],
      }),
    )
    expect(plan.rooms.map((r) => r.name)).toEqual(['Living room', 'Kitchen'])
    expect(plan.furniture.map((f) => f.name)).toEqual([sofa.name, 'Desk'])
  })

  it('accepts either list on its own', () => {
    expect(parseAIPlan(JSON.stringify({ rooms: [room] })).furniture).toEqual([])
    expect(parseAIPlan(JSON.stringify({ furniture: [sofa] })).rooms).toEqual([])
    expect(
      parseAIPlan(JSON.stringify({ rooms: [room], furniture: [] })).rooms,
    ).toHaveLength(1)
  })

  it('still reads a bare furniture object from the older prompt', () => {
    expect(parseAIPlan(furnitureJson())).toEqual({
      rooms: [],
      furniture: parseAIPlan(JSON.stringify({ furniture: [sofa] })).furniture,
    })
  })

  it('keeps a room unplaced unless it carries both coordinates', () => {
    const { xCm: _x, yCm: _y, ...loose } = room
    expect(parseAIPlan(planJson({ rooms: [loose] })).rooms[0]).toEqual({
      name: room.name,
      w: room.widthCm,
      h: room.depthCm,
    })
    expect(
      parseAIPlan(planJson({ rooms: [{ ...loose, xCm: 10 }] })).rooms[0],
    ).not.toHaveProperty('x')
    expect(
      parseAIPlan(planJson({ rooms: [{ ...room, xCm: -250 }] })).rooms[0],
    ).toHaveProperty('x', -250)
  })

  it('accepts one surrounding JSON or plain code fence', () => {
    expect(parseAIPlan(`\n\`\`\`json\n${planJson()}\n\`\`\`\n`)).toEqual(
      parseAIPlan(planJson()),
    )
    expect(parseAIPlan(`\`\`\`\r\n${planJson()}\r\n\`\`\``)).toEqual(
      parseAIPlan(planJson()),
    )
  })

  it('trims names and keeps dimensions at the minimum size', () => {
    expect(
      parseAIPlan(
        planJson({
          rooms: [{ ...room, name: '  Nook  ', widthCm: MIN_SIZE }],
          furniture: [{ ...sofa, name: '  Slim shelf  ', depthCm: MIN_SIZE }],
        }),
      ),
    ).toMatchObject({
      rooms: [{ name: 'Nook', w: MIN_SIZE }],
      furniture: [{ name: 'Slim shelf', h: MIN_SIZE }],
    })
  })

  it('defaults solidity from the kind without overriding an explicit value', () => {
    const { collides: _collides, ...withoutCollides } = sofa
    const collides = (item: Record<string, unknown>) =>
      parseAIPlan(JSON.stringify({ furniture: [item] })).furniture[0].collides

    expect(collides({ ...withoutCollides, kind: 'rug' })).toBe(false)
    expect(collides(withoutCollides)).toBe(true)
    expect(collides({ ...sofa, kind: 'rug', collides: true })).toBe(true)
    expect(collides({ ...sofa, collides: false })).toBe(false)
  })

  it('allows sourceUrl to be omitted and accepts only HTTP(S) sources', () => {
    const { sourceUrl: _sourceUrl, ...withoutSource } = sofa
    expect(
      parseAIPlan(JSON.stringify({ furniture: [withoutSource] })).furniture[0],
    ).not.toHaveProperty('sourceUrl')
    expect(
      parseAIPlan(
        planJson({ furniture: [{ ...sofa, sourceUrl: 'http://e.com/s' }] }),
      ).furniture[0],
    ).toHaveProperty('sourceUrl', 'http://e.com/s')

    for (const sourceUrl of [
      'ftp://example.com/spec',
      'example.com/spec',
      '/spec',
      '',
    ]) {
      expect(() =>
        parseAIPlan(planJson({ furniture: [{ ...sofa, sourceUrl }] })),
      ).toThrow('sourceUrl')
    }
  })

  it('rejects malformed, empty, prose-wrapped, or multiply fenced text', () => {
    expect(() => parseAIPlan('')).toThrow('Paste the plan JSON first')
    expect(() => parseAIPlan('{')).toThrow('not valid JSON')
    expect(() => parseAIPlan(`Here it is:\n${planJson()}`)).toThrow(
      'not valid JSON',
    )
    expect(() =>
      parseAIPlan(`\`\`\`json\n${planJson()}\n\`\`\`\nMore text`),
    ).toThrow('no text outside')
    expect(() =>
      parseAIPlan(
        `\`\`\`json\n${planJson()}\n\`\`\`\n\`\`\`json\n${planJson()}\n\`\`\``,
      ),
    ).toThrow()
  })

  it('rejects roots other than one object', () => {
    for (const value of [[], [sofa], null, 'furniture', 1, true]) {
      expect(() => parseAIPlan(JSON.stringify(value))).toThrow(
        'must be one JSON object',
      )
    }
  })

  it('rejects a response that would add nothing', () => {
    expect(() => parseAIPlan('{"rooms":[],"furniture":[]}')).toThrow(
      'at least one room',
    )
  })

  it('rejects unknown fields instead of silently importing the wrong shape', () => {
    for (const field of ['plan', 'openings', 'version']) {
      expect(() => parseAIPlan(planJson({ [field]: 10 }))).toThrow(field)
    }
    for (const field of ['heightCm', 'id', 'rotation']) {
      expect(() =>
        parseAIPlan(planJson({ furniture: [{ ...sofa, [field]: 10 }] })),
      ).toThrow(field)
      expect(() =>
        parseAIPlan(planJson({ rooms: [{ ...room, [field]: 10 }] })),
      ).toThrow(field)
    }
  })

  it('rejects lists that are not lists, and lists that are too long', () => {
    expect(() => parseAIPlan(JSON.stringify({ rooms: room }))).toThrow('rooms')
    expect(() =>
      parseAIPlan(JSON.stringify({ rooms: Array(51).fill(room) })),
    ).toThrow('no more than 50 rooms')
    expect(() =>
      parseAIPlan(JSON.stringify({ furniture: Array(51).fill(sofa) })),
    ).toThrow('no more than 50 pieces')
  })

  it('names the offending entry in a list', () => {
    expect(() =>
      parseAIPlan(
        planJson({ furniture: [sofa, { ...sofa, kind: 'cabinet' }] }),
      ),
    ).toThrow('furniture.1.kind')
    expect(() =>
      parseAIPlan(planJson({ rooms: [room, { ...room, widthCm: 0 }] })),
    ).toThrow('rooms.1.widthCm')
  })

  it('rejects missing or invalid names', () => {
    expect(() => parseAIPlan(furnitureJson({ name: '   ' }))).toThrow('name')
    expect(() => parseAIPlan(furnitureJson({ name: 'x'.repeat(81) }))).toThrow(
      'name',
    )
    expect(() =>
      parseAIPlan(planJson({ rooms: [{ ...room, name: 12 }] })),
    ).toThrow('name')
  })

  it('rejects unknown or differently cased kinds', () => {
    for (const kind of ['cabinet', 'Sofa', '']) {
      expect(() => parseAIPlan(furnitureJson({ kind }))).toThrow('kind')
    }
  })

  it('rejects missing, non-numeric, non-finite, and undersized dimensions', () => {
    const { widthCm: _widthCm, ...withoutWidth } = sofa
    expect(() => parseAIPlan(JSON.stringify(withoutWidth))).toThrow('widthCm')

    for (const [field, value] of [
      ['widthCm', '228'],
      ['widthCm', 0],
      ['widthCm', -1],
      ['widthCm', MIN_SIZE - 0.01],
      ['depthCm', null],
      ['depthCm', 0],
    ] as const) {
      expect(() => parseAIPlan(furnitureJson({ [field]: value }))).toThrow(
        field,
      )
    }

    expect(() => parseAIPlan(furnitureJson().replace('95.5', '1e999'))).toThrow(
      'depthCm',
    )
  })

  it('rejects dimensions too large for useful planner geometry', () => {
    expect(() => parseAIPlan(furnitureJson({ widthCm: 10_001 }))).toThrow(
      'widthCm',
    )
    expect(() =>
      parseAIPlan(planJson({ rooms: [{ ...room, depthCm: 10_001 }] })),
    ).toThrow('depthCm')
  })

  it('rejects room corners far outside any usable plan', () => {
    expect(() =>
      parseAIPlan(planJson({ rooms: [{ ...room, xCm: 100_001 }] })),
    ).toThrow('xCm')
    expect(() =>
      parseAIPlan(planJson({ rooms: [{ ...room, yCm: -100_001 }] })),
    ).toThrow('yCm')
  })

  it('rejects an invalid collides value', () => {
    expect(() => parseAIPlan(furnitureJson({ collides: 'true' }))).toThrow(
      'collides',
    )
  })

  it('rejects pasted responses larger than 20 KiB before parsing', () => {
    expect(() => parseAIPlan('x'.repeat(20 * 1024 + 1))).toThrow('under 20 KiB')
  })

  it('uses its own user-facing error type', () => {
    expect(() => parseAIPlan('{')).toThrow(AIPlanImportError)
  })
})

describe('placeRooms', () => {
  const sized = (name: string, w: number, h: number) => ({ name, w, h })

  it('keeps a response that placed its own rooms exactly where it put them', () => {
    const rooms = [
      { ...sized('A', 400, 300), x: 0, y: 0 },
      { ...sized('B', 200, 300), x: 400, y: 0 },
    ]
    expect(placeRooms(rooms).map((p) => p.rect)).toEqual([
      { x: 0, y: 0, w: 400, h: 300 },
      { x: 400, y: 0, w: 200, h: 300 },
    ])
  })

  it('arranges unplaced rooms in a spaced row', () => {
    const rects = placeRooms([sized('A', 400, 300), sized('B', 200, 500)]).map(
      (p) => p.rect,
    )
    expect(rects[0]).toEqual({ x: 0, y: 0, w: 400, h: 300 })
    expect(rects[1].x).toBe(430)
    expect(rects[1].y).toBe(0)
  })

  it('wraps a long row onto the next line, clearing the deepest room', () => {
    const rects = placeRooms([
      sized('A', 900, 400),
      sized('B', 600, 200),
      sized('C', 500, 300),
    ]).map((p) => p.rect)
    expect(rects[1].y).toBe(0)
    expect(rects[2]).toEqual({ x: 0, y: 430, w: 500, h: 300 })
  })

  it('keeps arranged rooms clear of the ones the response placed', () => {
    const rects = placeRooms([
      { ...sized('Placed', 400, 300), x: 0, y: 100 },
      sized('Loose', 200, 200),
    ]).map((p) => p.rect)
    expect(rects[1].y).toBe(430)
  })

  it('measures the box every room fits inside', () => {
    expect(
      layoutBounds(
        placeRooms([
          { ...sized('A', 400, 300), x: -100, y: -50 },
          { ...sized('B', 200, 100), x: 400, y: 0 },
        ]),
      ),
    ).toEqual({ x: -100, y: -50, w: 700, h: 300 })
    expect(layoutBounds([])).toEqual({ x: 0, y: 0, w: 0, h: 0 })
  })
})

describe('describeAIPlan', () => {
  it('counts what an import adds, in the singular and the plural', () => {
    const plan = parseAIPlan(planJson())
    expect(describeAIPlan(plan)).toBe('1 room and 1 piece of furniture')
    expect(describeAIPlan({ rooms: [], furniture: plan.furniture })).toBe(
      '1 piece of furniture',
    )
    expect(
      describeAIPlan({
        rooms: [...plan.rooms, ...plan.rooms],
        furniture: [...plan.furniture, ...plan.furniture],
      }),
    ).toBe('2 rooms and 2 pieces of furniture')
    expect(describeAIPlan({ rooms: [], furniture: [] })).toBe('nothing')
  })
})
