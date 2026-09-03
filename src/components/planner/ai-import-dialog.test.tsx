import { expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { AIImportDialog, AIImportForm } from './ai-import-dialog.tsx'

it('offers AI handoffs, prompt copying, and a guarded paste-to-add flow', () => {
  const html = renderToStaticMarkup(
    <AIImportForm units="metric" onImported={() => undefined} />,
  )

  expect(html).toContain('https://chatgpt.com/?q=')
  expect(html).toContain('https://claude.ai/new?q=')
  expect(html).toContain('https://www.perplexity.ai/search?s=o&amp;q=')
  expect(html).toContain('Copy prompt')
  expect(html).toContain('Review the prompt')
  expect(html).toContain('>AI response</label>')
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Add to plan/s)
})

it('puts one AI trigger in the toolbar, naming both rooms and furniture', () => {
  const html = renderToStaticMarkup(<AIImportDialog />)

  expect(html).toContain('Add rooms and furniture with AI')
  expect(html).toContain('>AI</span>')
})
