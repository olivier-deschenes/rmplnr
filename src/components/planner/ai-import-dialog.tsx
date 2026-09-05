import { useId, useMemo, useState } from 'react'
import { useSelector } from '@tanstack/react-store'
import {
  IconAlertTriangle,
  IconChevronRight,
  IconCopy,
  IconExternalLink,
  IconPlus,
  IconSparkles,
} from '@tabler/icons-react'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert.tsx'
import { Button } from '#/components/ui/button.tsx'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '#/components/ui/collapsible.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog.tsx'
import { Label } from '#/components/ui/label.tsx'
import { Textarea } from '#/components/ui/textarea.tsx'
import {
  AI_PLAN_PROMPT,
  describeAIPlan,
  parseAIPlan,
} from '#/lib/planner/aiPlan.ts'
import { FURNITURE_PRESETS } from '#/lib/planner/presets.ts'
import { plannerStore } from '#/lib/planner/store.ts'
import { formatSize } from '#/lib/planner/units.ts'

import type { AIPlanImport } from '#/lib/planner/aiPlan.ts'
import type { Units } from '#/lib/planner/types.ts'

const encodedPrompt = encodeURIComponent(AI_PLAN_PROMPT)

const AI_PROVIDERS = [
  { label: 'ChatGPT', href: `https://chatgpt.com/?q=${encodedPrompt}` },
  { label: 'Claude', href: `https://claude.ai/new?q=${encodedPrompt}` },
  {
    label: 'Perplexity',
    href: `https://www.perplexity.ai/search?s=o&q=${encodedPrompt}`,
  },
] as const

function checkedResponse(response: string): {
  plan: AIPlanImport | null
  error: string | null
} {
  if (response.trim().length === 0) return { plan: null, error: null }

  try {
    return { plan: parseAIPlan(response), error: null }
  } catch (problem) {
    return {
      plan: null,
      error:
        problem instanceof Error
          ? problem.message
          : 'That response could not be read.',
    }
  }
}

function sourceHost(sourceUrl: string): string {
  return new URL(sourceUrl).hostname.replace(/^www\./, '')
}

/** Everything the paste is about to put on the plan, before it goes on. */
function ImportPreview({ plan, units }: { plan: AIPlanImport; units: Units }) {
  return (
    <div className="grid max-h-44 gap-2 overflow-y-auto border px-3 py-2">
      {plan.rooms.length > 0 ? (
        <section className="grid gap-1" aria-labelledby="ai-preview-rooms">
          <h4 id="ai-preview-rooms" className="text-[10px] font-medium">
            Rooms ({plan.rooms.length})
          </h4>
          <ul className="grid gap-0.5">
            {plan.rooms.map((room, index) => (
              <li key={`${room.name}-${index}`} className="min-w-0">
                <span className="truncate font-medium">{room.name}</span>{' '}
                <span className="text-muted-foreground tabular-nums">
                  {formatSize(room.w, room.h, units)}
                  {room.x === undefined ? '' : ' · placed'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {plan.furniture.length > 0 ? (
        <section
          className="grid gap-1 not-first:border-t not-first:pt-2"
          aria-labelledby="ai-preview-furniture"
        >
          <h4 id="ai-preview-furniture" className="text-[10px] font-medium">
            Furniture ({plan.furniture.length})
          </h4>
          <ul className="grid gap-0.5">
            {plan.furniture.map((item, index) => (
              <li key={`${item.name}-${index}`} className="min-w-0">
                <span className="truncate font-medium">{item.name}</span>{' '}
                <span className="text-muted-foreground tabular-nums">
                  {FURNITURE_PRESETS[item.kind].label} ·{' '}
                  {formatSize(item.w, item.h, units)}
                  {item.collides ? '' : ' · overlap allowed'}
                </span>
                {item.sourceUrl ? (
                  <>
                    {' '}
                    <a
                      className="text-muted-foreground inline-flex items-center gap-1 underline underline-offset-3 hover:text-foreground"
                      href={item.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {sourceHost(item.sourceUrl)}
                      <IconExternalLink className="size-3" />
                    </a>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

/**
 * The research handoff and paste-in step for a whole import: any number of
 * rooms, any number of measured footprints, in one response.
 *
 * Nothing leaves the browser here. The prompt goes out to whichever service
 * the reader picked, carrying no part of the plan, and what comes back is
 * pasted in by hand and read locally before any of it is put down.
 */
export function AIImportForm({
  units,
  onImported,
}: {
  units: Units
  onImported: () => void
}) {
  const responseId = useId()
  const [response, setResponse] = useState('')
  const [showError, setShowError] = useState(false)
  const checked = useMemo(() => checkedResponse(response), [response])
  const visibleError = showError ? checked.error : null

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(AI_PLAN_PROMPT)
      toast.success('AI prompt copied.')
    } catch {
      toast.error('The prompt could not be copied.')
    }
  }

  const add = () => {
    const plan = checked.plan
    if (!plan) {
      setShowError(true)
      return
    }
    plannerStore.actions.addPlanImport(plan)
    setResponse('')
    setShowError(false)
    onImported()
    toast.success(`Added ${describeAIPlan(plan)} to the plan.`)
  }

  return (
    <>
      <div className="grid min-h-0 gap-5 overflow-y-auto pr-1">
        <section className="grid gap-3" aria-labelledby="ai-research-heading">
          <div className="grid gap-1">
            <h3 id="ai-research-heading" className="font-medium">
              1. Ask an AI
            </h3>
            <p className="text-muted-foreground">
              Open a new conversation with the research and formatting
              instructions, then describe the rooms and furniture you want. Some
              services send the instructions immediately.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {AI_PROVIDERS.map((provider) => (
              <Button key={provider.label} variant="outline" size="sm" asChild>
                <a
                  href={provider.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {provider.label}
                  <IconExternalLink data-icon="inline-end" />
                </a>
              </Button>
            ))}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void copyPrompt()}
            >
              <IconCopy data-icon="inline-start" />
              Copy prompt
            </Button>
          </div>
          <Collapsible className="text-muted-foreground">
            <CollapsibleTrigger className="group flex cursor-pointer items-center gap-1 text-foreground hover:underline hover:underline-offset-3">
              <IconChevronRight className="size-3 transition-transform group-data-[state=open]:rotate-90" />
              Review the prompt
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="mt-2 max-h-36 overflow-y-auto border-l-2 pl-3 text-[10px]/relaxed whitespace-pre-wrap">
                {AI_PLAN_PROMPT}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        </section>

        <section
          className="grid gap-3 border-t pt-4"
          aria-labelledby="ai-response-heading"
        >
          <div className="grid gap-1">
            <h3 id="ai-response-heading" className="font-medium">
              2. Paste the response
            </h3>
            <p id={`${responseId}-help`} className="text-muted-foreground">
              Paste the complete JSON response. Review it before adding; you can
              edit it here.
            </p>
          </div>
          <Label htmlFor={responseId} className="sr-only">
            AI response
          </Label>
          <Textarea
            id={responseId}
            value={response}
            className="min-h-32 max-h-56 resize-y font-mono"
            placeholder={
              '{"rooms":[{"name":"Living room","widthCm":450,"depthCm":380,"xCm":0,"yCm":0}],"furniture":[{"name":"KIVIK 3-seat sofa","kind":"sofa","widthCm":228,"depthCm":95}]}'
            }
            aria-invalid={visibleError ? true : undefined}
            aria-describedby={`${responseId}-help${visibleError ? ` ${responseId}-error` : ''}`}
            spellCheck={false}
            onBlur={() => setShowError(response.trim().length > 0)}
            onChange={(event) => {
              setResponse(event.target.value)
              setShowError(false)
            }}
          />

          {visibleError ? (
            <Alert id={`${responseId}-error`} variant="destructive">
              <IconAlertTriangle />
              <AlertTitle>Cannot add this response</AlertTitle>
              <AlertDescription>{visibleError}</AlertDescription>
            </Alert>
          ) : null}

          {checked.plan ? (
            <div aria-live="polite" className="grid gap-2">
              <p className="text-muted-foreground">
                Ready to add {describeAIPlan(checked.plan)}.
              </p>
              <ImportPreview plan={checked.plan} units={units} />
            </div>
          ) : null}
        </section>
      </div>

      <DialogFooter className="border-t pt-3 sm:justify-end">
        <Button disabled={response.trim().length === 0} onClick={add}>
          <IconPlus data-icon="inline-start" />
          Add to plan
        </Button>
      </DialogFooter>
    </>
  )
}

/** The bar's one way in to everything an AI can add to the plan. */
export function AIImportDialog({
  className,
  open: controlledOpen,
  onOpenChange,
}: {
  className?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen
  const units = useSelector(plannerStore, (state) => state.units)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {controlledOpen === undefined && (
        <DialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={className}
            aria-label="Add rooms and furniture with AI"
          >
            <IconSparkles data-icon="inline-start" />
            <span className="max-sm:sr-only">AI</span>
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="grid max-h-[min(90vh,44rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add with AI</DialogTitle>
          <DialogDescription>
            Ask an AI service to research rooms and furniture, then paste its
            JSON response here. rmplnr sends no plan data.
          </DialogDescription>
        </DialogHeader>
        <AIImportForm units={units} onImported={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}
