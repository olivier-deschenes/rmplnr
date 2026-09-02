import { expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { AIFurnitureImport } from './ai-furniture-import.tsx'

it('offers AI handoffs, prompt copying, and a guarded paste-to-add flow', () => {
  const html = renderToStaticMarkup(
    <AIFurnitureImport
      units="metric"
      onBack={() => undefined}
      onAdded={() => undefined}
    />,
  )

  expect(html).toContain('https://chatgpt.com/?q=')
  expect(html).toContain('https://claude.ai/new?q=')
  expect(html).toContain('https://www.perplexity.ai/search?s=o&amp;q=')
  expect(html).toContain('Copy prompt')
  expect(html).toContain('Review the prompt')
  expect(html).toContain('>AI response</label>')
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Add to plan/s)
})
