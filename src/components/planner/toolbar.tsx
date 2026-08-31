import { useEffect, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useSelector } from '@tanstack/react-store'
import { formatForDisplay } from '@tanstack/react-hotkeys'
import { toast } from 'sonner'
import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconArrowLeft,
  IconBarrierBlock,
  IconBrackets,
  IconChevronDown,
  IconCooker,
  IconCopy,
  IconDeviceFloppy,
  IconDownload,
  IconDoor,
  IconFocusCentered,
  IconHanger,
  IconJson,
  IconMagnet,
  IconMinus,
  IconPlus,
  IconPointer,
  IconPhoto,
  IconRectangle,
  IconSettings,
  IconSofa,
  IconSquareDashed,
  IconTable,
  IconTrash,
  IconVectorTriangle,
  IconWindow,
} from '@tabler/icons-react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog.tsx'
import { Button } from '#/components/ui/button.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu.tsx'
import { Kbd } from '#/components/ui/kbd.tsx'
import { Separator } from '#/components/ui/separator.tsx'
import { Toggle } from '#/components/ui/toggle.tsx'
import { ToggleGroup, ToggleGroupItem } from '#/components/ui/toggle-group.tsx'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip.tsx'

import { GitHubCommitDialog } from '#/features/github/GitHubCommitDialog.tsx'
import { GitHubRepositoryDialog } from '#/features/github/GitHubRepositoryDialog.tsx'
import { GitHubSyncControls } from '#/features/github/GitHubSyncControls.tsx'
import { useGithubSync } from '#/features/github/useGithubSync.ts'

import { downloadProjectJson } from '#/lib/planner/projectExport.ts'
import {
  FURNITURE_KINDS,
  FURNITURE_PRESETS,
  OPENING_PRESETS,
  OPENING_TOOLS,
} from '#/lib/planner/presets.ts'
import { currentProjects, plannerStore, saveNow } from '#/lib/planner/store.ts'
import { EDIT_KEYS, OPENING_KEYS, TOOL_KEYS } from '#/lib/planner/shortcuts.ts'
import {
  UNITS,
  UNIT_HINT,
  UNIT_LABEL,
  formatSnapStep,
} from '#/lib/planner/units.ts'

import type { ReactElement } from 'react'
import type { TablerIcon } from '@tabler/icons-react'
import type { Hotkey } from '@tanstack/react-hotkeys'
import type { DrawTool } from '#/lib/planner/shortcuts.ts'
import type { SaveFailure } from '#/lib/planner/store.ts'
import type {
  FurnitureKind,
  OpeningKind,
  Tool,
  Units,
} from '#/lib/planner/types.ts'

/**
 * Fill the active tool solid black; the default muted grey reads as disabled.
 *
 * Which one is active has to be read off ARIA rather than `data-state`: every
 * control in the bar is a tooltip trigger too, and the tooltip writes its own
 * open/closed state into that attribute, over the toggle's. A single-choice
 * group marks its items checked, a toggle standing alone marks itself pressed,
 * and neither is anything the tooltip touches.
 */
const SELECTED_TOOL =
  'aria-checked:bg-foreground aria-checked:text-background aria-pressed:bg-foreground aria-pressed:text-background'

/**
 * What a toggle standing on its own needs to keep step with the segmented
 * groups: their items lose their side padding to the join, so a lone one has
 * to give up the same or it stands a few pixels wider than everything else.
 */
const LONE_TOGGLE = `px-2 ${SELECTED_TOOL}`

/**
 * The bar draws itself in icons, so a control's name lives in its tooltip and
 * nowhere else. Every icon-only control gets one, with the key that would have
 * done the same thing from the canvas.
 */
function Hint({
  label,
  keys,
  children,
}: {
  label: string
  keys?: Hotkey
  children: ReactElement
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">
        {label}
        {keys && <Kbd>{formatForDisplay(keys)}</Kbd>}
      </TooltipContent>
    </Tooltip>
  )
}

/** The ways to put a room down, in the order the bar offers them. */
const DRAW_TOOLS: Array<{
  tool: DrawTool
  icon: TablerIcon
  label: string
}> = [
  { tool: 'select', icon: IconPointer, label: 'Select and move' },
  {
    tool: 'room',
    icon: IconVectorTriangle,
    label: 'Draw a room corner by corner',
  },
  {
    tool: 'rect',
    icon: IconRectangle,
    label: 'Drag out a rectangular room',
  },
]

/**
 * The face and shortcut key of each kind of opening the toolbar draws with.
 * A plain gap has no symbol of its own, so it wears its two jambs.
 *
 * Keyed off the list itself, so a kind cannot be added to the bar without
 * being given a face to wear there.
 */
const OPENING_TOOL_UI: Record<
  (typeof OPENING_TOOLS)[number],
  { icon: TablerIcon }
> = {
  door: { icon: IconDoor },
  window: { icon: IconWindow },
  opening: { icon: IconBrackets },
}

/** One per kind, so nothing can reach the Add menu faceless. */
const FURNITURE_ICONS: Record<FurnitureKind, TablerIcon> = {
  table: IconTable,
  sofa: IconSofa,
  kitchen: IconCooker,
  box: IconSquareDashed,
}

/**
 * Furniture is dropped in rather than drawn, so it sits behind one Add menu
 * instead of a button per kind — the bar stays the same width as the catalogue
 * grows.
 */
function AddMenu() {
  const tool = useSelector(plannerStore, (s) => s.tool)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={tool === 'closet' ? 'default' : 'outline'} size="sm">
          <IconPlus data-icon="inline-start" />
          Add
          <IconChevronDown
            data-icon="inline-end"
            className="text-muted-foreground"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-36">
        <DropdownMenuItem
          onSelect={() => plannerStore.actions.setTool('closet')}
        >
          <IconHanger />
          Closet
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {FURNITURE_KINDS.map((kind) => {
          const Icon = FURNITURE_ICONS[kind]
          return (
            <DropdownMenuItem
              key={kind}
              onSelect={() => plannerStore.actions.addFurniture(kind)}
            >
              <Icon />
              {FURNITURE_PRESETS[kind].label}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The plans the editor keeps, and the one open in it.
 *
 * A project is a plan under a name of its own, so the menu is named after the
 * plan being drawn on rather than after itself: what the bar shows is where
 * the work is, and the list under it is everywhere else it could be. Renaming
 * is not here — the name is a field in the inspector, beside the rest of what
 * the plan is.
 *
 * Which plan is open is the URL's to say, so everything here that opens one
 * navigates rather than reaching into the store. Deleting is the exception,
 * and only looks like one: the plan goes, the editor is left with nothing to
 * show, and the page sends the reader back to the list of its own accord.
 */
function ProjectMenu() {
  const projects = useSelector(plannerStore, (s) => s.projects)
  const projectId = useSelector(plannerStore, (s) => s.projectId)
  const open = projects.find((p) => p.id === projectId)
  // Deleting a plan is not a change to one, and there is no undo waiting on
  // the other side of it, so it is asked about first.
  const [confirming, setConfirming] = useState(false)
  const actions = plannerStore.actions
  const navigate = useNavigate()

  const show = (id: string | null) =>
    id && navigate({ to: '/p/$projectId', params: { projectId: id } })

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="max-w-44">
            <span className="truncate">{open?.name}</span>
            <IconChevronDown
              data-icon="inline-end"
              className="text-muted-foreground"
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuLabel>Plans</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={projectId ?? ''} onValueChange={show}>
            {projects.map((project) => (
              <DropdownMenuRadioItem key={project.id} value={project.id}>
                <span className="truncate">{project.name}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => show(actions.newProject())}>
            <IconPlus />
            New plan
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => show(actions.duplicateProject())}>
            <IconCopy />
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setConfirming(true)}
          >
            <IconTrash />
            Delete
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to="/">
              <IconArrowLeft />
              All plans
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {open?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The plan and everything drawn on it are gone for good.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
            <AlertDialogAction
              size="sm"
              variant="destructive"
              onClick={() => projectId && actions.deleteProject(projectId)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/**
 * What a refused write says, in the terms the reader can do something about.
 * Every one of them ends the same way, because with storage refusing the plan
 * exists only in this tab and exporting it is the way out.
 */
const SAVE_FAILURES: Record<SaveFailure, { label: string; detail: string }> = {
  quota: {
    label: 'Storage full',
    detail:
      'This browser has no room left for plans. Export this one, or delete a plan you no longer need.',
  },
  blocked: {
    label: 'Not saving',
    detail:
      'This browser is blocking local storage, so edits are not being kept. Export the plan to keep it.',
  },
  unknown: {
    label: 'Not saved',
    detail:
      'The browser refused the last change, so it is only in this tab. Export the plan to keep it.',
  },
}

/**
 * Whether what is on the canvas has made it into the browser yet.
 *
 * Plans live in this browser and nowhere else, so the one thing the bar owes
 * the reader is a straight answer about whether that has actually happened.
 * Resting, it is a word in the corner; refused, it becomes the loudest thing
 * in the bar and a button that tries again, because from that point on the
 * work is only in this tab.
 *
 * The resting states are not a live region: they change on every edit, and a
 * screen reader reading "Saving. Saved." over each keystroke would drown out
 * the drawing. A failure is announced instead, once, as a toast.
 */
function SaveStatus() {
  const status = useSelector(plannerStore, (s) => s.persistence.status)
  const failure = useSelector(plannerStore, (s) => s.persistence.failure)
  const failed = status === 'error'
  const problem = SAVE_FAILURES[failure ?? 'unknown']

  useEffect(() => {
    if (!failed) {
      toast.dismiss('planner-save')
      return
    }
    toast.error(problem.label, {
      id: 'planner-save',
      description: problem.detail,
    })
  }, [failed, problem])

  if (failed) {
    return (
      <Hint label={`${problem.detail} Click to try saving again.`}>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive gap-1.5 px-2"
          onClick={() => saveNow()}
        >
          <IconAlertTriangle />
          {problem.label}
        </Button>
      </Hint>
    )
  }

  return (
    <Hint
      label={
        status === 'saving'
          ? 'Saving this plan in your browser.'
          : 'Saved in this browser. Nothing is sent anywhere else.'
      }
    >
      <span
        tabIndex={0}
        className="text-muted-foreground flex items-center gap-1.5 px-1 text-xs whitespace-nowrap"
      >
        <IconDeviceFloppy className="size-3.5" />
        {status === 'saving' ? 'Saving' : 'Saved'}
      </span>
    </Hint>
  )
}

/** Download the open plan without hiding the action in the plan switcher. */
function ExportMenu() {
  // The library entry for the open plan trails the live canvas until it is
  // closed. Files must take the current rooms, furniture and openings instead.
  const current = () => {
    const state = plannerStore.state
    return currentProjects(state).find(
      (project) => project.id === state.projectId,
    )
  }

  const downloadJson = () => {
    const project = current()
    if (project) downloadProjectJson(project)
  }

  const downloadPng = async () => {
    const project = current()
    if (!project) return

    try {
      const { downloadProjectPng } = await import('./planImage.tsx')
      await downloadProjectPng(project, plannerStore.state.units)
    } catch {
      toast.error('Could not export the PNG image.')
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <IconDownload data-icon="inline-start" />
          Export
          <IconChevronDown
            data-icon="inline-end"
            className="text-muted-foreground"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onSelect={() => void downloadPng()}>
          <IconPhoto />
          PNG image
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={downloadJson}>
          <IconJson />
          JSON
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Committing plans to a GitHub repository, and everything it takes to set that
 * up.
 *
 * The whole feature is one button in the bar and two dialogs behind it, and
 * they are kept together here because the button is the only way to either
 * one. Nothing about the plans changes on GitHub's say-so without the reader
 * seeing it first: what arrives is shown as a review, and applied only when
 * they confirm it.
 */
function GitHubSync() {
  const [dialog, setDialog] = useState<'repository' | 'commit' | null>(null)
  const controller = useGithubSync()

  return (
    <>
      <GitHubSyncControls
        controller={controller}
        onOpenRepository={() => setDialog('repository')}
        onOpenCommit={() => setDialog('commit')}
      />
      <GitHubRepositoryDialog
        open={dialog === 'repository'}
        onOpenChange={(open) => setDialog(open ? 'repository' : null)}
        controller={controller}
      />
      <GitHubCommitDialog
        open={dialog === 'commit'}
        onOpenChange={(open) => setDialog(open ? 'commit' : null)}
        controller={controller}
        onManageRepository={() => setDialog('repository')}
      />
    </>
  )
}

/** Home for editor-wide settings, so the toolbar proper stays about drawing. */
function OptionsMenu() {
  const units = useSelector(plannerStore, (s) => s.units)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Options">
          <IconSettings />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>Units</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={units}
          onValueChange={(value) =>
            plannerStore.actions.setUnits(value as Units)
          }
        >
          {UNITS.map((value) => (
            <DropdownMenuRadioItem key={value} value={value}>
              {UNIT_LABEL[value]}
              <span className="text-muted-foreground text-[10px]">
                {UNIT_HINT[value]}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function Toolbar() {
  const tool = useSelector(plannerStore, (s) => s.tool)
  const openingKind = useSelector(plannerStore, (s) => s.openingKind)
  const snap = useSelector(plannerStore, (s) => s.snap)
  const collide = useSelector(plannerStore, (s) => s.collide)
  const units = useSelector(plannerStore, (s) => s.units)
  const scale = useSelector(plannerStore, (s) => s.viewport.scale)
  const canUndo = useSelector(plannerStore, (s) => s.history.past.length > 0)
  const canRedo = useSelector(plannerStore, (s) => s.history.future.length > 0)
  const actions = plannerStore.actions

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b px-2">
      <ProjectMenu />
      <SaveStatus />

      <Separator orientation="vertical" className="mx-1 h-5" />

      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        value={tool}
        onValueChange={(value) => value && actions.setTool(value as Tool)}
      >
        {DRAW_TOOLS.map(({ tool: value, icon: Icon, label }) => (
          <Hint key={value} label={label} keys={TOOL_KEYS[value]}>
            <ToggleGroupItem
              value={value}
              className={SELECTED_TOOL}
              aria-label={label}
            >
              <Icon />
            </ToggleGroupItem>
          </Hint>
        ))}
      </ToggleGroup>

      {/*
        Openings are placed on a wall rather than dropped on the floor, so they
        are tools of their own: pick one, then click the wall to cut it in.
      */}
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        value={tool === 'opening' ? openingKind : ''}
        onValueChange={(value) =>
          value && actions.setOpeningTool(value as OpeningKind)
        }
      >
        {OPENING_TOOLS.map((kind) => {
          const { icon: Icon } = OPENING_TOOL_UI[kind]
          const label = `Place ${OPENING_PRESETS[kind].label.toLowerCase()} on a wall`
          return (
            <Hint key={kind} label={label} keys={OPENING_KEYS[kind]}>
              <ToggleGroupItem
                value={kind}
                className={SELECTED_TOOL}
                aria-label={label}
              >
                <Icon />
              </ToggleGroupItem>
            </Hint>
          )
        })}
      </ToggleGroup>

      <AddMenu />

      <Separator orientation="vertical" className="mx-1 h-5" />

      <Hint label={`Snap to ${formatSnapStep(units)}`}>
        <Toggle
          variant="outline"
          size="sm"
          className={LONE_TOGGLE}
          aria-label="Snap to grid"
          pressed={snap}
          onPressedChange={() => actions.toggleSnap()}
        >
          <IconMagnet />
        </Toggle>
      </Hint>

      {/*
        Furniture holds itself out of the walls and out of everything else,
        which is what the plan is for. Turned off for the times a plan has to
        say something a real room could not — a rug under a table, or two
        layouts drawn over each other to be compared.
      */}
      <Hint label="Keep furniture out of walls and other furniture">
        <Toggle
          variant="outline"
          size="sm"
          className={LONE_TOGGLE}
          aria-label="Collision"
          pressed={collide}
          onPressedChange={() => actions.toggleCollide()}
        >
          <IconBarrierBlock />
        </Toggle>
      </Hint>

      <div className="ml-auto flex items-center gap-0.5">
        <Hint label="Undo" keys={EDIT_KEYS.undo}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Undo"
            disabled={!canUndo}
            onClick={() => actions.undo()}
          >
            <IconArrowBackUp />
          </Button>
        </Hint>
        <Hint label="Redo" keys={EDIT_KEYS.redo}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Redo"
            disabled={!canRedo}
            onClick={() => actions.redo()}
          >
            <IconArrowForwardUp />
          </Button>
        </Hint>

        <Separator orientation="vertical" className="mx-1.5 h-5" />

        <Hint label="Zoom out">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom out"
            onClick={() => actions.zoomBy(1 / 1.25)}
          >
            <IconMinus />
          </Button>
        </Hint>
        {/*
          The readout doubles as the way back to life size, so its name has to
          say so — with the percentage it shows still in there.
        */}
        <Hint label="Reset zoom to 100%">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground w-11 px-0 tabular-nums"
            aria-label={`${Math.round(scale * 100)}% — reset zoom to 100%`}
            onClick={() => actions.zoomTo(1)}
          >
            {Math.round(scale * 100)}%
          </Button>
        </Hint>
        <Hint label="Zoom in">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom in"
            onClick={() => actions.zoomBy(1.25)}
          >
            <IconPlus />
          </Button>
        </Hint>
        <Hint label="Fit plan to view">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Fit plan to view"
            onClick={() => actions.fit()}
          >
            <IconFocusCentered />
          </Button>
        </Hint>

        <Separator orientation="vertical" className="mx-1.5 h-5" />

        <ExportMenu />
        <GitHubSync />
        <OptionsMenu />
      </div>
    </div>
  )
}
