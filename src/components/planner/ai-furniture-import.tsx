import { useId, useMemo, useState } from 'react'
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCheck,
  IconChevronRight,
  IconCopy,
  IconExternalLink,
  IconPlus,
} from '@tabler/icons-react'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert.tsx'
import { Button } from '#/components/ui/button.tsx'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '#/components/ui/collapsible.tsx'
import { DialogFooter } from '#/components/ui/dialog.tsx'
import { Label } from '#/components/ui/label.tsx'
import { Textarea } from '#/components/ui/textarea.tsx'
import {
  AI_FURNITURE_PROMPT,
  parseAIFurniture,
} from '#/lib/planner/aiFurniture.ts'
import { FURNITURE_PRESETS } from '#/lib/planner/presets.ts'
import { plannerStore } from '#/lib/planner/store.ts'
import { formatSize } from '#/lib/planner/units.ts'

import type { AIFurnitureImport } from '#/lib/planner/aiFurniture.ts'
import type { Units } from '#/lib/planner/types.ts'

const encodedPrompt = encodeURIComponent(AI_FURNITURE_PROMPT)

const AI_PROVIDERS = [
  { label: 'ChatGPT', href: `https://chatgpt.com/?q=${encodedPrompt}` },
  { label: 'Claude', href: `https://claude.ai/new?q=${encodedPrompt}` },
  {
    label: 'Perplexity',
    href: `https://www.perplexity.ai/search?s=o&q=${encodedPrompt}`,
  },
] as const

function checkedResponse(response: string): {
  item: AIFurnitureImport | null
  error: string | null
} {
  if (response.trim().length === 0) return { item: null, error: null }

  try {
    return { item: parseAIFurniture(response), error: null }
  } catch (problem) {
    return {
      item: null,
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

/** Research handoff and local paste-in step for one measured footprint. */
export function AIFurnitureImport({
  units,
  onBack,
  onAdded,
}: {
  units: Units
  onBack: () => void
  onAdded: () => void
}) {
  const responseId = useId()
  const [response, setResponse] = useState('')
  const [showError, setShowError] = useState(false)
  const checked = useMemo(() => checkedResponse(response), [response])
  const visibleError = showError ? checked.error : null

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(AI_FURNITURE_PROMPT)
      toast.success('AI prompt copied.')
    } catch {
      toast.error('The prompt could not be copied.')
    }
  }

  const add = () => {
    const item = checked.item
    if (!item) {
      setShowError(true)
      return
    }
    plannerStore.actions.addFurnitureFootprint({
      name: item.name,
      kind: item.kind,
      w: item.w,
      h: item.h,
      collides: item.collides,
    })
    onAdded()
    toast.success(`${item.name} added to the plan.`)
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
              instructions. Some services send them immediately.
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
                {AI_FURNITURE_PROMPT}
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
              '{"name":"KIVIK 3-seat sofa","kind":"sofa","widthCm":228,"depthCm":95,"collides":true,"sourceUrl":"https://…"}'
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

          {checked.item ? (
            <div
              className="flex items-start gap-2 border px-3 py-2"
              aria-live="polite"
            >
              <IconCheck className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0">
                <p className="truncate font-medium">{checked.item.name}</p>
                <p className="text-muted-foreground tabular-nums">
                  {FURNITURE_PRESETS[checked.item.kind].label} ·{' '}
                  {formatSize(checked.item.w, checked.item.h, units)} ·{' '}
                  {checked.item.collides
                    ? 'solid footprint'
                    : 'overlap allowed'}
                </p>
                {checked.item.sourceUrl ? (
                  <a
                    className="text-muted-foreground inline-flex items-center gap-1 underline underline-offset-3 hover:text-foreground"
                    href={checked.item.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Source: {sourceHost(checked.item.sourceUrl)}
                    <IconExternalLink className="size-3" />
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>
      </div>

      <DialogFooter className="border-t pt-3 sm:justify-between">
        <Button variant="outline" onClick={onBack}>
          <IconArrowLeft data-icon="inline-start" />
          Back to catalogue
        </Button>
        <Button disabled={response.trim().length === 0} onClick={add}>
          <IconPlus data-icon="inline-start" />
          Add to plan
        </Button>
      </DialogFooter>
    </>
  )
}
