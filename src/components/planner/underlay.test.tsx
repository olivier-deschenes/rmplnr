import { expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { UnderlayImage } from './underlay.tsx'

import type { Underlay } from '#/lib/planner/underlay.ts'

function background(overrides: Partial<Underlay> = {}): Underlay {
  return {
    id: 'underlay-1',
    projectId: '11111111-1111-4111-8111-111111111111',
    name: 'floor.png',
    source: 'image',
    page: null,
    mimeType: 'image/png',
    blob: new Blob(),
    pixelWidth: 1000,
    pixelHeight: 500,
    x: 10,
    y: 20,
    width: 800,
    height: 400,
    opacity: 0.4,
    visible: true,
    ...overrides,
  }
}

it('draws a calibrated underlay without making it interactive', () => {
  const html = renderToStaticMarkup(
    <svg>
      <UnderlayImage
        underlay={background()}
        href="data:image/png;base64,eA=="
      />
    </svg>,
  )

  expect(html).toContain('data-plan-underlay="true"')
  expect(html).toContain('pointer-events-none')
  expect(html).toContain('x="10"')
  expect(html).toContain('width="800"')
  expect(html).toContain('opacity="0.4"')
})

it('keeps a hidden underlay out of the normal canvas', () => {
  const html = renderToStaticMarkup(
    <svg>
      <UnderlayImage
        underlay={background({ visible: false })}
        href="data:image/png;base64,eA=="
      />
    </svg>,
  )

  expect(html).not.toContain('data-plan-underlay')
})

it('shows a locked outline only during explicit positioning', () => {
  const html = renderToStaticMarkup(
    <svg>
      <UnderlayImage
        underlay={background({ visible: false })}
        href="data:image/png;base64,eA=="
        positioning
        scale={2}
      />
    </svg>,
  )

  expect(html).toContain('<rect')
  expect(html).toContain('stroke-width="0.5"')
  expect(html).toContain('opacity="0.15"')
})
