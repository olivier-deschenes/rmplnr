import { useLayoutEffect } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useSelector } from '@tanstack/react-store'

import { Landing } from '#/components/landing.tsx'
import { PageLayout } from '#/components/page-layout.tsx'
import { plannerStore, restoreLibrary } from '#/lib/planner/store.ts'
import { createStarterPlan } from '#/lib/planner/starterPlan.ts'

export const Route = createFileRoute('/')({
  component: Home,
  head: () => ({
    meta: [
      { title: 'rmplnr · A little room to think' },
      {
        name: 'description',
        content:
          'Draw your rooms, arrange furniture, and see what fits with rmplnr, a simple 2D room planner. No account needed. Plans save in your browser.',
      },
    ],
  }),
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
