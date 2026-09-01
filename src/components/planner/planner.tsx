import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useSelector } from '@tanstack/react-store'
import { IconAdjustmentsHorizontal } from '@tabler/icons-react'

import { Canvas } from './canvas.tsx'
import { CanvasGuidance } from './guidance.tsx'
import { Inspector } from './inspector.tsx'
import { Toolbar } from './toolbar.tsx'

import { TabConflictDialog } from '#/components/tab-conflict.tsx'
import { Button } from '#/components/ui/button.tsx'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '#/components/ui/sheet.tsx'
import { TooltipProvider } from '#/components/ui/tooltip.tsx'

import { plannerStore, restoreLibrary } from '#/lib/planner/store.ts'
import { underlayStore } from '#/lib/planner/underlay.ts'

function MobileInspector() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const wide = window.matchMedia('(min-width: 64rem)')
    const closeAtDesktop = () => {
      if (wide.matches) setOpen(false)
    }
    closeAtDesktop()
    wide.addEventListener('change', closeAtDesktop)
    return () => wide.removeEventListener('change', closeAtDesktop)
  }, [])

  const changeOpen = (next: boolean) => {
    setOpen(next)
    requestAnimationFrame(() => plannerStore.actions.fit())
  }

  return (
    <Sheet open={open} onOpenChange={changeOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-11 lg:hidden"
          aria-label="Open inspector"
        >
          <IconAdjustmentsHorizontal />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-[min(22rem,calc(100vw-2rem))] p-0 [&>[data-slot=sheet-close]]:size-11"
      >
        <SheetHeader className="shrink-0 border-b p-3 pr-14">
          <SheetTitle>Inspector</SheetTitle>
          <SheetDescription className="sr-only">
            Edit the plan or the selected room, wall, opening, or furniture.
          </SheetDescription>
        </SheetHeader>
        <Inspector
          nameId="mobile-plan-name"
          className="min-h-0 w-full flex-1 border-0 [&_[data-slot=button]]:min-h-11 [&_[data-slot=input]]:min-h-11 [&_[data-slot=select-trigger]]:min-h-11 [&_[data-slot=toggle-group-item]]:min-h-11"
        />
      </SheetContent>
    </Sheet>
  )
}

export function Planner({ projectId }: { projectId: string }) {
  // localStorage is client-only, so the library is read back after mount —
  // before the plan is asked for, which is why both live in the one effect.
  // Leaving hands the plan back to the library, so that the list on the way
  // out has the room just drawn on it rather than the plan as it was opened.
  useEffect(() => {
    restoreLibrary()
    plannerStore.actions.openProject(projectId)
    void underlayStore.actions.open(projectId)
    return () => {
      underlayStore.actions.close(projectId)
      plannerStore.actions.closeProject()
    }
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

  return (
    // Long enough a delay that sweeping across the toolbar does not set off
    // every tooltip on the way past.
    <TooltipProvider delayDuration={400}>
      <div className="flex h-dvh flex-col overflow-hidden">
        <Toolbar inspector={<MobileInspector />} />
        <div className="flex min-h-0 flex-1">
          <div className="relative min-w-0 flex-1">
            <Canvas />
            <CanvasGuidance
              onProjectImported={(id) =>
                navigate({ to: '/p/$projectId', params: { projectId: id } })
              }
            />
          </div>
          <Inspector className="hidden lg:flex" />
        </div>
        <TabConflictDialog />
      </div>
    </TooltipProvider>
  )
}
