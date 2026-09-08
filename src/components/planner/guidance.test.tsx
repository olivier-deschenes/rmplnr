import { closeWallPoints } from '#/lib/planner/geometry.ts'
import { beforeEach, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { CanvasGuidance } from './guidance.tsx'
import { HistoryPanel } from './history.tsx'
import { SHORTCUT_GROUPS } from './shortcuts-dialog.tsx'

import { plannerStore } from '#/lib/planner/store.ts'

import type { Project } from '#/lib/planner/types.ts'

const PLAN = '11111111-1111-4111-8111-111111111111'

function plan(populated = false): Project {
  return {
    spaces: [],
    id: PLAN,
    name: 'Plan 1',
    walls: populated
      ? [
          {
            id: 'room-1',
            name: 'Living room',
            points: closeWallPoints([
              { x: 0, y: 0 },
              { x: 400, y: 0 },
              { x: 400, y: 300 },
            ]),
          },
        ]
      : [],
    furniture: [],
    openings: [],
  }
}

function open(project = plan()) {
  plannerStore.actions.closeProject()
  plannerStore.actions.loadLibrary({ version: 1, projects: [project] })
  plannerStore.actions.openProject(PLAN)
}

function guidance() {
  return renderToStaticMarkup(
    <CanvasGuidance onProjectImported={() => undefined} />,
  )
}

beforeEach(() => open())

it('offers the three useful ways to start an empty plan', () => {
  const html = guidance()

  expect(html).toContain('data-canvas-empty-state="true"')
  expect(html).toContain('Rectangle walls')
  expect(html).toContain('Draw walls')
  expect(html).toContain('Import plan')
})

it('follows a polygon from its first corner through finishing it', () => {
  plannerStore.actions.setTool('run')
  expect(guidance()).toContain('Click anywhere to start a run')

  plannerStore.actions.addDraftPoint({ x: 0, y: 0 })
  expect(guidance()).toContain('Click the endpoint')

  plannerStore.actions.addDraftPoint({ x: 400, y: 0 })
  plannerStore.actions.addDraftPoint({ x: 400, y: 300 })
  expect(guidance()).toContain('Enter or Esc stops and keeps your walls')

  plannerStore.actions.commitDraft()
  const finished = guidance()
  expect(finished).not.toContain('data-canvas-tool-guidance')
  expect(finished).not.toContain('data-canvas-empty-state')
})

it('explains cancellation and panning for the rectangle tool', () => {
  plannerStore.actions.setTool('rect')

  const html = guidance()
  expect(html).toContain('Hold Space and drag to pan')
  expect(html).toContain('press Esc to cancel')
  expect(html).toContain('>Cancel</button>')
})

it('offers touch controls and enables finishing only after three corners', () => {
  plannerStore.actions.setTool('run')
  plannerStore.actions.addDraftPoint({ x: 0, y: 0 })

  const started = guidance()
  expect(started).toContain('aria-label="Undo last wall"')
  expect(started).toMatch(/<button[^>]*aria-label="Close room"[^>]*disabled=""/)

  plannerStore.actions.addDraftPoint({ x: 400, y: 0 })
  plannerStore.actions.addDraftPoint({ x: 400, y: 300 })

  const ready = guidance()
  expect(ready).toContain('aria-label="Close room"')
  expect(ready).not.toMatch(
    /<button[^>]*aria-label="Close room"[^>]*disabled=""/,
  )
  expect(ready).toContain('>Stop drawing</button>')
})

it('offers a Done button while placing openings', () => {
  plannerStore.actions.setOpeningTool('door')

  expect(guidance()).toContain('>Done</button>')
})

it('distinguishes an untouched blank plan from a reopened populated plan', () => {
  expect(renderToStaticMarkup(<HistoryPanel />)).toContain(
    'Nothing yet. Draw walls to start.',
  )

  open(plan(true))
  expect(renderToStaticMarkup(<HistoryPanel />)).toContain(
    'No edits this session',
  )
})

it('lists drawing, finishing, cancellation, and panning shortcuts', () => {
  const labels = SHORTCUT_GROUPS.flatMap((group) =>
    group.shortcuts.map((shortcut) => shortcut.label),
  )

  expect(labels).toContain('Rectangle walls')
  expect(labels).toContain('Stop drawing walls')
  expect(labels).toContain('Cancel current action')
  expect(labels).toContain('Pan from anywhere')
})
