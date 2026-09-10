import { useEffect, useLayoutEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useSelector } from '@tanstack/react-store'
import { IconAdjustmentsHorizontal } from '@tabler/icons-react'

import { Canvas } from './canvas.tsx'
import { CanvasGuidance } from './guidance.tsx'
import { Inspector } from './inspector.tsx'
import { Toolbar } from './toolbar.tsx'

import { TabConflictDialog } from '#/components/tab-conflict.tsx'
import { PageLoading } from '#/components/page-loading.tsx'
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

  return (
    <Sheet open={open} onOpenChange={setOpen}>
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
        <SheetHeader className="shrink-0 border-b p-4 pr-14">
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
  // localStorage is client-only, so the library is read back after mount.
  // A layout effect keeps the empty editor from reaching the first paint.
  // Leaving hands the plan back to the library, so that the list on the way
  // out has the room just drawn on it rather than the plan as it was opened.
  useLayoutEffect(() => {
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
  const ready = useSelector(
    plannerStore,
    (s) => s.restored && s.projectId === projectId,
  )
  const missing = useSelector(
    plannerStore,
    (s) => s.restored && !s.projects.some((p) => p.id === projectId),
  )
  const name = useSelector(
    plannerStore,
    (s) => s.projects.find((p) => p.id === projectId)?.name ?? '',
  )

  useEffect(() => {
    if (missing) navigate({ to: '/projects', replace: true })
  }, [missing, navigate])

  if (!ready) return <PageLoading label="Opening plan…" />

  return (
    // Long enough a delay that sweeping across the toolbar does not set off
    // every tooltip on the way past.
    <TooltipProvider delayDuration={400}>
      <div className="flex h-dvh flex-col overflow-hidden">
        {/*
          The toolbar stands nearly thirty controls between the top of the page
          and the drawing, so the keyboard is shown the same way past it that
          the rest of the site shows past its header.
        */}
        <a
          href="#plan-canvas"
          className="bg-background fixed top-3 left-3 z-50 -translate-y-24 rounded-md border px-4 py-3 text-sm focus:translate-y-0 focus-visible:outline-2 focus-visible:outline-ring"
        >
          Skip to the plan
        </a>
        <Toolbar inspector={<MobileInspector />} />
        <div className="flex min-h-0 flex-1">
          {/*
            The drawing is what this page is, so it holds the main landmark and
            the page's one heading. The heading is only for readers who cannot
            see the plan: on screen the name is already up in the toolbar, on
            the control that renames it.
          */}
          <main
            id="plan-canvas"
            tabIndex={-1}
            className="relative min-w-0 flex-1 outline-none"
          >
            <h1 className="sr-only">{name}</h1>
            <Canvas />
            <CanvasGuidance
              onProjectImported={(id) =>
                navigate({ to: '/p/$projectId', params: { projectId: id } })
              }
            />
          </main>
          <Inspector className="hidden lg:flex" />
        </div>
        <TabConflictDialog />
      </div>
    </TooltipProvider>
  )
}
