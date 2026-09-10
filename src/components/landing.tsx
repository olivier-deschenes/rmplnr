import { useState } from 'react'
import { IconArrowRight, IconUpload } from '@tabler/icons-react'

import { ImportDialog } from '#/components/planner/import-dialog.tsx'
import { PlanPreview } from '#/components/planner/plan-preview.tsx'
import { Button } from '#/components/ui/button.tsx'
import { ToggleGroup, ToggleGroupItem } from '#/components/ui/toggle-group.tsx'
import { FAQ } from '#/lib/faq.ts'
import { planFloors } from '#/lib/planner/enclosures.ts'
import { createStarterPlan } from '#/lib/planner/starterPlan.ts'
import { formatArea } from '#/lib/planner/units.ts'

import type { Units } from '#/lib/planner/types.ts'

export function Landing({
  units,
  onStart,
  onTryExample,
  onProjectImported,
}: {
  units: Units
  onStart: () => void
  onTryExample: () => void
  onProjectImported: (id: string) => void
}) {
  const [example] = useState(createStarterPlan)
  const [view, setView] = useState('furnished')
  const { floor, count } = planFloors(example.walls, example.spaces)

  return (
    <>
      <section
        aria-labelledby="welcome-title"
        className="grid items-center gap-12 py-12 sm:py-16 lg:grid-cols-2 lg:gap-16 lg:py-12"
      >
        <div className="min-w-0">
          <h1
            id="welcome-title"
            className="max-w-lg text-5xl leading-[1.08] font-medium tracking-[-0.055em] sm:text-6xl"
          >
            See what fits.
            <span className="text-muted-foreground mt-1 block">
              Before you move it.
            </span>
          </h1>
          <p className="text-muted-foreground mt-6 max-w-sm text-base leading-relaxed sm:text-lg">
            Draw your rooms, place your furniture, and find a layout that feels
            right. A free 2D room planner for floor plans and furniture layouts.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button onClick={onStart} className="h-11 gap-2 px-5 text-sm">
              Start a plan
              <IconArrowRight aria-hidden="true" data-icon="inline-end" />
            </Button>
            <Button
              onClick={onTryExample}
              variant="outline"
              className="h-11 px-5 text-sm"
            >
              Try an example
            </Button>
          </div>
          <p className="text-muted-foreground mt-4 text-sm">
            No account needed. Saved in your browser.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-x-2 text-sm">
            <span className="text-muted-foreground">Have a plan already?</span>
            <ImportDialog
              trigger={
                <Button variant="ghost" className="h-10 px-2 text-sm">
                  <IconUpload aria-hidden="true" data-icon="inline-start" />
                  Import JSON
                </Button>
              }
              onProjectImported={onProjectImported}
            />
          </div>
        </div>

        <figure className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{example.name}</p>
              <p className="text-muted-foreground mt-1 text-xs tabular-nums">
                {count} rooms · {formatArea(floor, units)}
              </p>
            </div>
            <ToggleGroup
              type="single"
              value={view}
              onValueChange={(value) => {
                if (value) setView(value)
              }}
              aria-label="Example plan view"
              spacing={0}
              className="rounded-md border p-1"
            >
              <ToggleGroupItem value="furnished" className="h-9 px-3">
                Furnished
              </ToggleGroupItem>
              <ToggleGroupItem value="floor-plan" className="h-9 px-3">
                Floor plan
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="mt-5 aspect-[480/428] rounded-md bg-muted/40">
            <PlanPreview
              project={example}
              annotated
              showFurniture={view === 'furnished'}
              units={units}
            />
          </div>
          <figcaption className="text-muted-foreground mt-4 flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs">
            <span>A real plan, ready to make your own.</span>
            <span className="font-mono">Drawn to scale</span>
          </figcaption>
        </figure>
      </section>

      <section
        aria-label="From an idea to a room that works"
        className="grid gap-8 border-t py-10 sm:gap-10 sm:py-12 md:grid-cols-3"
      >
        <div>
          <h2 className="text-base font-medium tracking-tight">
            Draw your space to scale
          </h2>
          <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
            Draw rooms to your measurements. Add doors and windows, with
            dimensions in metric or imperial.
          </p>
        </div>
        <div>
          <h2 className="text-base font-medium tracking-tight">
            Arrange furniture, check clearances
          </h2>
          <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
            Put furniture in at its real size and see what the walkways have
            left. Move things around until the layout works.
          </p>
        </div>
        <div>
          <h2 className="text-base font-medium tracking-tight">
            Your floor plans stay yours
          </h2>
          <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
            Plans save in this browser. Export whenever you like, or choose
            which plans to sync with GitHub.
          </p>
        </div>
      </section>

      <section aria-labelledby="faq-title" className="border-t py-10 sm:py-12">
        <h2 id="faq-title" className="text-base font-medium tracking-tight">
          Questions
        </h2>
        <dl className="mt-8 grid gap-8 sm:gap-10 md:grid-cols-2 md:gap-x-16">
          {FAQ.map((entry) => (
            <div key={entry.question}>
              <dt className="text-sm font-medium tracking-tight">
                {entry.question}
              </dt>
              <dd className="text-muted-foreground mt-3 text-sm leading-relaxed">
                {entry.answer}
              </dd>
            </div>
          ))}
        </dl>
        <div className="mt-12 flex flex-wrap items-center gap-x-4 gap-y-3">
          <Button onClick={onStart} className="h-11 gap-2 px-5 text-sm">
            Start a plan
            <IconArrowRight aria-hidden="true" data-icon="inline-end" />
          </Button>
          <p className="text-muted-foreground text-sm">
            Nothing to install, nothing to sign up for.
          </p>
        </div>
      </section>
    </>
  )
}
