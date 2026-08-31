import { useRef, useState } from 'react'
import { useSelector } from '@tanstack/react-store'
import {
  IconAlertTriangle,
  IconFileText,
  IconLibrary,
} from '@tabler/icons-react'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert.tsx'
import { Button } from '#/components/ui/button.tsx'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog.tsx'
import { Input } from '#/components/ui/input.tsx'
import { Spinner } from '#/components/ui/spinner.tsx'

import { parseRmplnrFile } from '#/lib/planner/planSerialization.ts'
import { currentProjects, plannerStore, saveNow } from '#/lib/planner/store.ts'

import type { ChangeEvent, ReactElement } from 'react'
import type { ParsedRmplnrFile } from '#/lib/planner/planSerialization.ts'
import type { Project } from '#/lib/planner/types.ts'

type Prepared = ParsedRmplnrFile & { fileName: string }

function projectContents(project: Project): string {
  const pieces = [
    `${project.rooms.length} room${project.rooms.length === 1 ? '' : 's'}`,
    `${project.furniture.length} item${project.furniture.length === 1 ? '' : 's'}`,
    `${project.openings.length} opening${project.openings.length === 1 ? '' : 's'}`,
  ]
  return pieces.join(' · ')
}

function applied(message: string): void {
  saveNow()
  const { conflict, persistence } = plannerStore.state
  if (persistence.status === 'error') {
    toast.warning(
      `${message} It is only in this tab until browser saving works.`,
    )
  } else if (conflict) {
    toast.warning(`${message} Resolve the other-tab conflict to save it.`)
  } else {
    toast.success(message)
  }
}

export function ImportDialog({
  trigger,
  onProjectImported,
}: {
  trigger: ReactElement
  onProjectImported?: (id: string) => void
}) {
  const projects = useSelector(plannerStore, (state) => state.projects)
  const [open, setOpen] = useState(false)
  const [prepared, setPrepared] = useState<Prepared | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [inputKey, setInputKey] = useState(0)
  const read = useRef(0)

  const duplicate =
    prepared?.kind === 'project'
      ? projects.find((project) => project.id === prepared.project.id)
      : undefined

  const reset = () => {
    read.current += 1
    setPrepared(null)
    setError(null)
    setReading(false)
    setInputKey((key) => key + 1)
  }

  const changeOpen = (next: boolean) => {
    setOpen(next)
    if (!next) reset()
  }

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const request = ++read.current
    setPrepared(null)
    setError(null)
    setReading(true)

    try {
      const parsed = parseRmplnrFile(await file.text())
      if (request !== read.current) return
      setPrepared({ ...parsed, fileName: file.name })
    } catch (problem) {
      if (request !== read.current) return
      setError(
        problem instanceof Error
          ? problem.message
          : 'This file could not be read.',
      )
    } finally {
      if (request === read.current) setReading(false)
    }
  }

  const importProject = (mode: 'replace' | 'copy') => {
    if (prepared?.kind !== 'project') return
    const id = plannerStore.actions.importProject(prepared.project, mode)
    const imported = currentProjects(plannerStore.state).find(
      (project) => project.id === id,
    )
    changeOpen(false)
    applied(
      mode === 'replace' && duplicate
        ? `Replaced ${prepared.project.name}.`
        : `Imported ${imported?.name ?? prepared.project.name}.`,
    )
    onProjectImported?.(id)
  }

  const restoreBackup = () => {
    if (prepared?.kind !== 'library') return
    const count = prepared.library.projects.length
    plannerStore.actions.restoreBackup(prepared.library)
    changeOpen(false)
    applied(`Restored ${count} plan${count === 1 ? '' : 's'}.`)
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import rmplnr JSON</DialogTitle>
          <DialogDescription>
            Choose one exported plan or a full-library backup. Nothing changes
            until you review it below.
          </DialogDescription>
        </DialogHeader>

        <Input
          key={inputKey}
          type="file"
          accept=".json,application/json"
          aria-label="rmplnr JSON file"
          aria-invalid={error ? true : undefined}
          disabled={reading}
          onChange={(event) => void choose(event)}
        />

        {reading && (
          <div className="text-muted-foreground flex items-center gap-2 py-3">
            <Spinner />
            Checking every plan…
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <IconAlertTriangle />
            <AlertTitle>Cannot import this file</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {prepared?.kind === 'project' && (
          <div className="grid gap-3 border p-3">
            <div className="flex min-w-0 items-start gap-2">
              <IconFileText className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0">
                <p className="truncate font-medium">{prepared.project.name}</p>
                <p className="text-muted-foreground">
                  {projectContents(prepared.project)}
                </p>
                <p className="text-muted-foreground truncate">
                  {prepared.fileName}
                </p>
              </div>
            </div>
            {duplicate && (
              <Alert>
                <IconAlertTriangle />
                <AlertTitle>This plan is already in the library</AlertTitle>
                <AlertDescription>
                  Replace {duplicate.name}, or keep both by importing this one
                  as a copy with a new ID.
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {prepared?.kind === 'library' && (
          <div className="grid gap-3 border p-3">
            <div className="flex items-start gap-2">
              <IconLibrary className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-medium">
                  {prepared.library.projects.length} plan
                  {prepared.library.projects.length === 1 ? '' : 's'}
                </p>
                <p className="text-muted-foreground truncate">
                  {prepared.fileName}
                </p>
              </div>
            </div>
            {prepared.library.projects.length > 0 && (
              <ul className="max-h-36 overflow-y-auto border-y">
                {prepared.library.projects.map((project) => (
                  <li
                    key={project.id}
                    className="flex items-baseline justify-between gap-3 border-b px-2 py-1.5 last:border-b-0"
                  >
                    <span className="truncate">{project.name}</span>
                    <span className="text-muted-foreground shrink-0 text-[10px]">
                      {project.rooms.length} room
                      {project.rooms.length === 1 ? '' : 's'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Alert variant="destructive">
              <IconAlertTriangle />
              <AlertTitle>Replace this browser’s library</AlertTitle>
              <AlertDescription>
                Restoring this backup removes all {projects.length} current plan
                {projects.length === 1 ? '' : 's'} and replaces them with the
                preview above.
              </AlertDescription>
            </Alert>
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              Cancel
            </Button>
          </DialogClose>
          {prepared?.kind === 'project' && duplicate && (
            <Button size="sm" onClick={() => importProject('copy')}>
              Import as copy
            </Button>
          )}
          {prepared?.kind === 'project' && (
            <Button
              variant={duplicate ? 'destructive' : 'default'}
              size="sm"
              onClick={() => importProject('replace')}
            >
              {duplicate ? 'Replace existing' : 'Import plan'}
            </Button>
          )}
          {prepared?.kind === 'library' && (
            <Button variant="destructive" size="sm" onClick={restoreBackup}>
              Restore library
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
