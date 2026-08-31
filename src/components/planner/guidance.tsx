import { useState } from 'react'
import { useSelector } from '@tanstack/react-store'
import {
  IconInfoCircle,
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

import type { PlannerState } from '#/lib/planner/store.ts'

type ToolGuide = { title: string; detail: string }

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
  const [importing, setImporting] = useState(false)

  if (!state.restored || !state.projectId) return null

  const guide = instructionFor(state)

  if (state.empty && state.tool === 'select') {
    return (
      <>
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center p-4">
          <Card
            size="sm"
            className="pointer-events-auto w-full max-w-lg bg-background/95 shadow-lg backdrop-blur-sm"
            data-canvas-empty-state
          >
            <CardHeader className="text-center">
              <CardTitle id="start-plan-title">Start this plan</CardTitle>
              <CardDescription>
                Draw from scratch, or bring in an rmplnr JSON file.
              </CardDescription>
            </CardHeader>
            <CardContent
              className="grid gap-2 sm:grid-cols-3"
              aria-labelledby="start-plan-title"
            >
              <Button
                variant="outline"
                className="h-auto min-h-14 justify-start sm:flex-col sm:justify-center"
                onClick={() => plannerStore.actions.setTool('rect')}
              >
                <IconRectangle />
                Rectangle room
              </Button>
              <Button
                variant="outline"
                className="h-auto min-h-14 justify-start sm:flex-col sm:justify-center"
                onClick={() => plannerStore.actions.setTool('room')}
              >
                <IconVectorTriangle />
                Custom outline
              </Button>
              <Button
                variant="outline"
                className="h-auto min-h-14 justify-start sm:flex-col sm:justify-center"
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
    <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex justify-center">
      <Alert
        className="w-auto max-w-xl bg-background/95 shadow-sm backdrop-blur-sm"
        data-canvas-tool-guidance
      >
        <IconInfoCircle />
        <AlertTitle>{guide.title}</AlertTitle>
        <AlertDescription>{guide.detail}</AlertDescription>
      </Alert>
    </div>
  )
}
