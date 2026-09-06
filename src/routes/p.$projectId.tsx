import { createFileRoute } from '@tanstack/react-router'

import { Planner } from '#/components/planner/planner.tsx'
import { seo } from '#/lib/seo.ts'

/**
 * One plan, open in the editor. The id in the path is the plan's own, so a
 * plan can be linked to, bookmarked, and come back to where it was left.
 */
export const Route = createFileRoute('/p/$projectId')({
  component: Plan,
  // The id names a plan held in one browser, so the page is different for
  // everyone and empty for a crawler. Out of the index, but still worth
  // unfurling properly when the link is pasted somewhere.
  head: () =>
    seo({
      title: 'Editing a plan · rmplnr',
      description:
        'Draw rooms, place doors and furniture, and check what fits in the rmplnr plan editor.',
      noindex: true,
    }),
})

function Plan() {
  const { projectId } = Route.useParams()
  return <Planner projectId={projectId} />
}
