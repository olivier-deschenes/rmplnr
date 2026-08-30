import { useEffect, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useSelector } from '@tanstack/react-store'

import { Canvas } from './canvas.tsx'
import { Inspector } from './inspector.tsx'
import { Toolbar } from './toolbar.tsx'

import { TooltipProvider } from '#/components/ui/tooltip.tsx'

import { plannerStore, restoreLibrary } from '#/lib/planner/store.ts'

export function Planner({ projectId }: { projectId: string }) {
  // localStorage is client-only, so the library is read back after mount —
  // before the plan is asked for, which is why both live in the one effect.
  // Leaving hands the plan back to the library, so that the list on the way
  // out has the room just drawn on it rather than the plan as it was opened.
  useEffect(() => {
    restoreLibrary()
    plannerStore.actions.openProject(projectId)
    return () => plannerStore.actions.closeProject()
  }, [projectId])

  // A plan that is not in the library is not a plan to draw on: an old link,
  // or the one just deleted from the toolbar. Either way the list is where the
  // reader should be, and `replace` keeps it out of the way of the back button.
  const navigate = useNavigate()
  const missing = useSelector(
    plannerStore,
    (s) => s.restored && !s.projects.some((p) => p.id === projectId),
  )

  useEffect(() => {
    if (missing) navigate({ to: '/', replace: true })
  }, [missing, navigate])

  // The canvas reports its size once it has laid out; frame the plan then.
  const width = useSelector(plannerStore, (s) => s.size.width)
  const framed = useRef(false)

  useEffect(() => {
    if (framed.current || width === 0) return
    framed.current = true
    plannerStore.actions.fit()
  }, [width])

  return (
    // Long enough a delay that sweeping across the toolbar does not set off
    // every tooltip on the way past.
    <TooltipProvider delayDuration={400}>
      <div className="flex h-dvh flex-col overflow-hidden">
        <Toolbar />
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1">
            <Canvas />
          </div>
          <Inspector />
        </div>
      </div>
    </TooltipProvider>
  )
}
