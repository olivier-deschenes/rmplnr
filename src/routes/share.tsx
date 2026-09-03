import { useEffect, useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'

import { PageLoading } from '#/components/page-loading.tsx'
import { Button } from '#/components/ui/button.tsx'

import { serializeProject } from '#/lib/planner/planSerialization.ts'
import { decodeSharedProject } from '#/lib/planner/planSharing.ts'
import {
  currentProjects,
  plannerStore,
  restoreLibrary,
  saveNow,
} from '#/lib/planner/store.ts'

export const Route = createFileRoute('/share')({ component: SharedPlan })

function SharedPlan() {
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false

    const open = async () => {
      try {
        const payload = window.location.hash.slice(1)
        const shared = await decodeSharedProject(payload)
        if (cancelled) return

        restoreLibrary()
        const existing = currentProjects(plannerStore.state).find(
          (project) => project.id === shared.id,
        )
        const isAlreadyHere =
          existing && serializeProject(existing) === serializeProject(shared)
        const id = isAlreadyHere
          ? shared.id
          : plannerStore.actions.importProject(
              shared,
              existing ? 'copy' : 'replace',
            )

        if (!isAlreadyHere) {
          saveNow()
          toast.success(
            existing
              ? `Added ${shared.name} as a copy.`
              : `Added ${shared.name} to your plans.`,
          )
        }

        await navigate({
          to: '/p/$projectId',
          params: { projectId: id },
          replace: true,
        })
      } catch (problem) {
        if (!cancelled) {
          setError(
            problem instanceof Error
              ? problem.message
              : 'This share link could not be opened.',
          )
        }
      }
    }

    void open()
    return () => {
      cancelled = true
    }
  }, [navigate])

  if (!error) return <PageLoading label="Opening shared plan…" />

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-6 py-16">
      <header className="grid gap-1">
        <p className="text-sm">rmplnr</p>
        <p className="text-muted-foreground text-[11px]">
          Draw a room, and what goes in it.
        </p>
      </header>
      <section className="grid gap-1">
        <h1 className="text-sm">Could not open shared plan</h1>
        <p className="text-muted-foreground text-[11px] leading-relaxed">
          {error} Ask the sender for a new link.
        </p>
      </section>
      <Button asChild variant="outline" size="sm" className="self-start">
        <Link to="/">All plans</Link>
      </Button>
    </main>
  )
}
