import { useEffect, useRef } from 'react'
import { useSelector } from '@tanstack/react-store'

import { Canvas } from './canvas.tsx'
import { Inspector } from './inspector.tsx'
import { Toolbar } from './toolbar.tsx'

import { TooltipProvider } from '#/components/ui/tooltip.tsx'

import {
  loadStoredPlan,
  loadStoredPrefs,
  plannerStore,
  startAutosave,
} from '#/lib/planner/store.ts'

export function Planner() {
  // localStorage is client-only, so restore and start autosaving after mount.
  useEffect(() => {
    const stored = loadStoredPlan()
    if (stored) {
      plannerStore.actions.loadPlan(
        stored.rooms,
        stored.furniture,
        stored.openings,
      )
    }
    const prefs = loadStoredPrefs()
    if (prefs) {
      plannerStore.actions.setUnits(prefs.units)
      plannerStore.actions.setCollide(prefs.collide)
    }
    return startAutosave()
  }, [])

  // The canvas reports its size once it has laid out; frame the plan then.
  const width = useSelector(plannerStore, (s) => s.size.width)
  const framed = useRef(false)

  useEffect(() => {
    if (framed.current || width === 0) return
    framed.current = true
    const state = plannerStore.state
    if (state.rooms.length > 0 || state.furniture.length > 0) {
      plannerStore.actions.fit()
    } else {
      // Nothing to frame yet: put the world origin in the middle of the canvas.
      plannerStore.actions.setViewport({
        ...state.viewport,
        tx: state.size.width / 2,
        ty: state.size.height / 2,
      })
    }
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
