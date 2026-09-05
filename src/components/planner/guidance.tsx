import { useState } from 'react'
import { useSelector } from '@tanstack/react-store'
import {
  IconArrowBackUp,
  IconCheck,
  IconRectangle,
  IconUpload,
  IconVectorTriangle,
} from '@tabler/icons-react'

import { ImportDialog } from './import-dialog.tsx'

import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert.tsx'
import { Button } from '#/components/ui/button.tsx'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card.tsx'

import { OPENING_PRESETS } from '#/lib/planner/presets.ts'
import { plannerStore } from '#/lib/planner/store.ts'
import { underlayStore } from '#/lib/planner/underlay.ts'

import type { PlannerState } from '#/lib/planner/store.ts'
import type { ReactNode } from 'react'

type ToolGuide = { title: string; detail: string }

const GUIDE_BUTTON = 'pointer-events-auto h-9 px-3 max-sm:min-h-11'

function ToolGuidance({
  title,
  detail,
  children,
}: ToolGuide & { children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-x-4 top-4 z-10 flex justify-center">
      <Alert
        role="status"
        className="flex w-auto max-w-2xl flex-col gap-3 rounded-md bg-background px-4 py-3 shadow-none sm:flex-row sm:items-center sm:gap-5"
        data-canvas-tool-guidance
      >
        <div className="min-w-0 space-y-1">
          <AlertTitle className="text-[13px]">{title}</AlertTitle>
          <AlertDescription className="text-xs leading-relaxed">
            {detail}
          </AlertDescription>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {children}
        </div>
      </Alert>
    </div>
  )
}

/** The instruction that follows a drawing tool until it is put away. */
export function instructionFor(
  state: Pick<PlannerState, 'tool' | 'draft' | 'openingKind'>,
): ToolGuide | null {
  if (state.tool === 'rect') {
    return {
      title: 'Rectangle room',
      detail:
        'Drag between opposite corners. Hold Space and drag to pan; press Esc to cancel.',
    }
  }

  if (state.tool === 'room') {
    if (!state.draft) {
      return {
        title: 'Custom outline',
        detail:
          'Click to place the first corner. Hold Space and drag to pan; press Esc to cancel.',
      }
    }
    if (state.draft.length < 3) {
      return {
        title: 'Custom outline',
        detail:
          'Click to place the next corner. Backspace removes the last corner; Esc cancels.',
      }
    }
    return {
      title: 'Finish the outline',
      detail:
        'Click the first corner or press Enter to finish. Backspace removes the last corner; Esc cancels.',
    }
  }

  if (state.tool === 'opening') {
    const name = OPENING_PRESETS[state.openingKind].label.toLowerCase()
    return {
      title: `Place ${name}`,
      detail: `Click a wall to place the ${name}. Hold Space and drag to pan; press Esc when done.`,
    }
  }

  if (state.tool === 'closet') {
    return {
      title: 'Place a closet',
      detail:
        'Click a wall to place the closet. Hold Space and drag to pan; press Esc when done.',
    }
  }

  return null
}

/** First-run choices and the short instruction for whichever tool is active. */
export function CanvasGuidance({
  onProjectImported,
}: {
  onProjectImported: (id: string) => void
}) {
  const state = useSelector(plannerStore, (current) => ({
    restored: current.restored,
    projectId: current.projectId,
    empty:
      current.rooms.length === 0 &&
      current.furniture.length === 0 &&
      current.openings.length === 0,
    tool: current.tool,
    draft: current.draft,
    openingKind: current.openingKind,
  }))
  const background = useSelector(underlayStore, (current) => ({
    loading: current.status === 'loading',
    present: current.underlay !== null,
    positioning: current.positioning,
  }))
  const [importing, setImporting] = useState(false)

  if (!state.restored || !state.projectId || background.loading) return null

  if (background.positioning) {
    return (
      <ToolGuidance
        title="Position the underlay"
        detail="Drag to align the background. Hold Space and drag to pan."
      >
        <Button
          size="sm"
          className={GUIDE_BUTTON}
          onClick={() => underlayStore.actions.setPositioning(false)}
        >
          <IconCheck />
          Done
        </Button>
      </ToolGuidance>
    )
  }

  const guide = instructionFor(state)

  if (background.present && state.empty && state.tool === 'select') {
    return (
      <ToolGuidance
        title="Trace the underlay"
        detail="Draw a room over the calibrated background."
      >
        <Button
          size="sm"
          className={GUIDE_BUTTON}
          onClick={() => plannerStore.actions.setTool('rect')}
        >
          <IconRectangle />
          Rectangle room
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={GUIDE_BUTTON}
          onClick={() => plannerStore.actions.setTool('room')}
        >
          Custom outline
        </Button>
      </ToolGuidance>
    )
  }

  if (state.empty && state.tool === 'select') {
    return (
      <>
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center p-4">
          <Card
            className="pointer-events-auto w-full max-w-sm gap-6 rounded-lg bg-background py-6 shadow-none [--card-spacing:--spacing(6)]"
            data-canvas-empty-state
          >
            <CardHeader className="gap-2">
              <CardTitle
                id="start-plan-title"
                className="text-2xl tracking-tight"
              >
                Start with a room
              </CardTitle>
              <CardDescription className="text-sm leading-relaxed">
                Draw your space, add furniture, and find a layout that works.
              </CardDescription>
            </CardHeader>
            <CardContent
              className="grid grid-cols-2 gap-2"
              aria-labelledby="start-plan-title"
            >
              <Button
                className="col-span-2 h-11 gap-2"
                onClick={() => plannerStore.actions.setTool('rect')}
              >
                <IconRectangle />
                Rectangle room
              </Button>
              <Button
                variant="outline"
                className="h-11 gap-2"
                onClick={() => plannerStore.actions.setTool('room')}
              >
                <IconVectorTriangle />
                Custom outline
              </Button>
              <Button
                variant="outline"
                className="h-11 gap-2"
                onClick={() => setImporting(true)}
              >
                <IconUpload />
                Import plan
              </Button>
            </CardContent>
          </Card>
        </div>
        <ImportDialog
          open={importing}
          onOpenChange={setImporting}
          onProjectImported={onProjectImported}
        />
      </>
    )
  }

  if (!guide) return null

  return (
    <ToolGuidance {...guide}>
      {state.tool === 'room' && state.draft && (
        <>
          <Button
            variant="outline"
            size="sm"
            className={GUIDE_BUTTON}
            aria-label="Undo last corner"
            onClick={() => plannerStore.actions.popDraftPoint()}
          >
            <IconArrowBackUp />
            Undo corner
          </Button>
          <Button
            size="sm"
            className={GUIDE_BUTTON}
            aria-label="Finish outline"
            disabled={state.draft.length < 3}
            onClick={() => plannerStore.actions.commitDraft()}
          >
            <IconCheck />
            Finish
          </Button>
        </>
      )}
      <Button
        variant="outline"
        size="sm"
        className={GUIDE_BUTTON}
        onClick={() => plannerStore.actions.setTool('select')}
      >
        {state.tool === 'opening' || state.tool === 'closet'
          ? 'Done'
          : 'Cancel'}
      </Button>
    </ToolGuidance>
  )
}
