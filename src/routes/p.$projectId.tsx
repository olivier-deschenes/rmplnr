import { createFileRoute } from '@tanstack/react-router'

import { Planner } from '#/components/planner/planner.tsx'

/**
 * One plan, open in the editor. The id in the path is the plan's own, so a
 * plan can be linked to, bookmarked, and come back to where it was left.
 */
export const Route = createFileRoute('/p/$projectId')({ component: Plan })

function Plan() {
  const { projectId } = Route.useParams()
  return <Planner projectId={projectId} />
}
