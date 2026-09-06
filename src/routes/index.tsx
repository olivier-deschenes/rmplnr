import { useLayoutEffect } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useSelector } from '@tanstack/react-store'

import { Landing } from '#/components/landing.tsx'
import { PageLayout } from '#/components/page-layout.tsx'
import { plannerStore, restoreLibrary } from '#/lib/planner/store.ts'
import { createStarterPlan } from '#/lib/planner/starterPlan.ts'
import { jsonLd, seo } from '#/lib/seo.ts'
import { landingStructuredData } from '#/lib/structuredData.ts'

export const Route = createFileRoute('/')({
  component: Home,
  head: () => {
    // The one page written for a search result: it keeps the canonical URL,
    // and it is the only place the site describes itself to a crawler.
    const { meta, links } = seo({ path: '/' })
    return {
      meta: [...meta, jsonLd(landingStructuredData())],
      links,
    }
  },
})

function Home() {
  useLayoutEffect(() => {
    restoreLibrary()
  }, [])
  const units = useSelector(plannerStore, (state) => state.units)
  const navigate = useNavigate()
  const open = (id: string) =>
    navigate({ to: '/p/$projectId', params: { projectId: id } })
  const start = () => open(plannerStore.actions.newProject())
  const tryExample = () =>
    open(plannerStore.actions.importProject(createStarterPlan(), 'copy'))

  return (
    <PageLayout>
      <Landing
        units={units}
        onStart={start}
        onTryExample={tryExample}
        onProjectImported={open}
      />
    </PageLayout>
  )
}
