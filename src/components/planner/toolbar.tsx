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
  IconCopy,
  IconDeviceFloppy,
  IconDownload,
  IconDoor,
  IconFocusCentered,
  IconJson,
  IconKeyboard,
  IconMagnet,
  IconMinus,
  IconPlus,
  IconPointer,
  IconPhoto,
  IconPhotoScan,
  IconRectangle,
  IconSettings,
  IconShare,
  IconTrash,
  IconUpload,
  IconVectorTriangle,
  IconWindow,
} from '@tabler/icons-react'

import { AIImportDialog } from './ai-import-dialog.tsx'
import { ImportDialog } from './import-dialog.tsx'
import { FurnitureCatalogue } from './furniture-catalogue.tsx'
import { ShortcutsDialog } from './shortcuts-dialog.tsx'
import { UnderlayDialog } from './underlay-dialog.tsx'

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
  DropdownMenuCheckboxItem,
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

import { GitHubSync } from '#/features/github/GitHubSync.tsx'

import {
  downloadLibraryBackup,
  downloadProjectJson,
} from '#/lib/planner/projectExport.ts'
import { OPENING_PRESETS, OPENING_TOOLS } from '#/lib/planner/presets.ts'
import { projectShareUrl } from '#/lib/planner/planSharing.ts'
import { currentProjects, plannerStore, saveNow } from '#/lib/planner/store.ts'
import { EDIT_KEYS, OPENING_KEYS, TOOL_KEYS } from '#/lib/planner/shortcuts.ts'
import { underlayStore } from '#/lib/planner/underlay.ts'
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
import type { OpeningKind, Tool, Units } from '#/lib/planner/types.ts'

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

/** One compact opening picker replaces three adjacent tools on phones. */
function OpeningMenu() {
  const tool = useSelector(plannerStore, (s) => s.tool)
  const openingKind = useSelector(plannerStore, (s) => s.openingKind)
  const active = OPENING_TOOLS.find((kind) => kind === openingKind) ?? 'door'
  const Icon = OPENING_TOOL_UI[active].icon

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={tool === 'opening' ? 'default' : 'outline'}
          size="icon-sm"
          className="size-11 sm:hidden"
          aria-label={`Place ${OPENING_PRESETS[active].label.toLowerCase()}`}
        >
          <Icon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuLabel>Place on a wall</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={active}
          onValueChange={(value) =>
            plannerStore.actions.setOpeningTool(value as OpeningKind)
          }
        >
          {OPENING_TOOLS.map((kind) => {
            const KindIcon = OPENING_TOOL_UI[kind].icon
            return (
              <DropdownMenuRadioItem
                key={kind}
                value={kind}
                className="min-h-11"
              >
                <KindIcon />
                {OPENING_PRESETS[kind].label}
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
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

  const duplicate = async () => {
    const source = projectId
    const copy = actions.duplicateProject()
    if (!copy) return
    if (source) {
      try {
        await underlayStore.actions.copyProject(source, copy)
      } catch {
        toast.warning('The plan was copied without its underlay.')
      }
    }
    show(copy)
  }

  const remove = () => {
    if (!projectId) return
    void underlayStore.actions.deleteProject(projectId)
    actions.deleteProject(projectId)
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="max-w-44 max-sm:h-11 max-sm:max-w-24"
          >
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
          <DropdownMenuItem onSelect={() => void duplicate()}>
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
            <AlertDialogAction size="sm" variant="destructive" onClick={remove}>
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
          className="text-destructive gap-1.5 px-2 max-sm:h-11"
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
        className="text-muted-foreground flex min-h-7 items-center gap-1.5 px-1 text-xs whitespace-nowrap max-sm:min-h-11"
      >
        <IconDeviceFloppy className="size-3.5" />
        {status === 'saving' ? 'Saving' : 'Saved'}
      </span>
    </Hint>
  )
}

function UnderlayControl() {
  const [open, setOpen] = useState(false)
  const { underlay, status, failure, positioning } = useSelector(underlayStore)
  const failed = status === 'error'

  useEffect(() => {
    if (!failed) {
      toast.dismiss('underlay-save')
      return
    }
    const detail =
      failure === 'quota'
        ? 'This browser has no room left for the background image.'
        : failure === 'blocked'
          ? 'This browser is blocking the underlay image store.'
          : 'The browser could not save the background image.'
    toast.error('Underlay not saved', {
      id: 'underlay-save',
      description: `${detail} The plan itself is still safe.`,
    })
  }, [failed, failure])

  const label = underlay ? 'Manage underlay' : 'Add image or PDF underlay'

  return (
    <>
      <Hint label={positioning ? 'Finish positioning the underlay' : label}>
        <Button
          variant={positioning ? 'default' : 'outline'}
          size="sm"
          className="max-sm:size-11 max-sm:px-0"
          aria-label={label}
          disabled={status === 'loading'}
          onClick={() =>
            positioning
              ? underlayStore.actions.setPositioning(false)
              : setOpen(true)
          }
        >
          {failed ? <IconAlertTriangle /> : <IconPhotoScan />}
          <span className="max-xl:sr-only">Underlay</span>
        </Button>
      </Hint>
      <UnderlayDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

// The library entry for the open plan trails the live canvas until it is
// closed. Files must take the current rooms, furniture and openings instead.
function currentProject() {
  const state = plannerStore.state
  return currentProjects(state).find(
    (project) => project.id === state.projectId,
  )
}

function downloadJson() {
  const project = currentProject()
  if (project) downloadProjectJson(project)
}

async function downloadPng(includeUnderlay = false) {
  const project = currentProject()
  if (!project) return

  try {
    const { downloadProjectPng } = await import('./planImage.tsx')
    await downloadProjectPng(
      project,
      plannerStore.state.units,
      includeUnderlay ? (underlayStore.state.underlay ?? undefined) : undefined,
    )
  } catch {
    toast.error('Could not export the PNG image.')
  }
}

function downloadBackup() {
  downloadLibraryBackup(currentProjects(plannerStore.state))
}

/** Use the native share sheet where there is one, and copy everywhere else. */
async function shareProject(): Promise<void> {
  const project = currentProject()
  if (!project) return

  try {
    const url = await projectShareUrl(project)
    const nativeShare: unknown = Reflect.get(navigator, 'share')
    if (typeof nativeShare === 'function') {
      try {
        await nativeShare.call(navigator, {
          title: `${project.name} · rmplnr`,
          url,
        })
        return
      } catch (problem) {
        if (problem instanceof DOMException && problem.name === 'AbortError') {
          return
        }
      }
    }

    await navigator.clipboard.writeText(url)
    toast.success('Share link copied.')
  } catch {
    toast.error('Could not share this plan.')
  }
}

/** Download the open plan without hiding the action in the plan switcher. */
function ExportMenu() {
  const underlay = useSelector(underlayStore, (state) => state.underlay)

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
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>Current plan</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => void downloadPng()}>
          <IconPhoto />
          PNG image
        </DropdownMenuItem>
        {underlay && (
          <DropdownMenuItem onSelect={() => void downloadPng(true)}>
            <IconPhotoScan />
            PNG with underlay
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={downloadJson}>
          <IconJson />
          JSON
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>All plans</DropdownMenuLabel>
        <DropdownMenuItem onSelect={downloadBackup}>
          <IconDownload />
          Library backup
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Import and every export in one small-screen menu. */
function FileMenu({
  onProjectImported,
}: {
  onProjectImported: (id: string) => void
}) {
  const [importing, setImporting] = useState(false)
  const underlay = useSelector(underlayStore, (state) => state.underlay)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="max-sm:size-11 max-sm:px-0"
            aria-label="Share, import, or export"
          >
            <IconDownload data-icon="inline-start" />
            <span className="max-sm:sr-only">Files</span>
            <IconChevronDown
              data-icon="inline-end"
              className="text-muted-foreground max-sm:hidden"
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-48 max-sm:[&_[data-slot=dropdown-menu-item]]:min-h-11"
        >
          <DropdownMenuItem
            className="min-h-11 sm:hidden"
            onSelect={() => void shareProject()}
          >
            <IconShare />
            Share plan
          </DropdownMenuItem>
          <DropdownMenuSeparator className="sm:hidden" />
          <DropdownMenuItem onSelect={() => setImporting(true)}>
            <IconUpload />
            Import JSON
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Current plan</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => void downloadPng()}>
            <IconPhoto />
            Export PNG
          </DropdownMenuItem>
          {underlay && (
            <DropdownMenuItem onSelect={() => void downloadPng(true)}>
              <IconPhotoScan />
              Export PNG with underlay
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={downloadJson}>
            <IconJson />
            Export JSON
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={downloadBackup}>
            <IconDownload />
            Back up all plans
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ImportDialog
        open={importing}
        onOpenChange={setImporting}
        onProjectImported={onProjectImported}
      />
    </>
  )
}

/** Home for editor-wide settings, so the toolbar proper stays about drawing. */
function OptionsMenu({ onOpenShortcuts }: { onOpenShortcuts: () => void }) {
  const units = useSelector(plannerStore, (s) => s.units)
  const collide = useSelector(plannerStore, (s) => s.collide)
  const actions = plannerStore.actions

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="max-sm:size-11"
          aria-label="Options"
        >
          <IconSettings />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="sm:hidden">Drawing</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          className="min-h-11 sm:hidden"
          checked={collide}
          onCheckedChange={() => actions.toggleCollide()}
        >
          <IconBarrierBlock />
          Avoid collisions
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator className="sm:hidden" />
        <DropdownMenuLabel className="md:hidden">View</DropdownMenuLabel>
        <DropdownMenuItem
          className="min-h-11 md:hidden"
          onSelect={() => actions.zoomBy(1.25)}
        >
          <IconPlus />
          Zoom in
        </DropdownMenuItem>
        <DropdownMenuItem
          className="min-h-11 md:hidden"
          onSelect={() => actions.zoomBy(1 / 1.25)}
        >
          <IconMinus />
          Zoom out
        </DropdownMenuItem>
        <DropdownMenuItem
          className="min-h-11 md:hidden"
          onSelect={() => actions.zoomTo(1)}
        >
          <IconFocusCentered />
          Reset zoom
        </DropdownMenuItem>
        <DropdownMenuItem
          className="min-h-11 md:hidden"
          onSelect={() => actions.fit()}
        >
          <IconFocusCentered />
          Fit plan to view
        </DropdownMenuItem>
        <DropdownMenuSeparator className="md:hidden" />
        <DropdownMenuLabel>Units</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={units}
          onValueChange={(value) => actions.setUnits(value as Units)}
        >
          {UNITS.map((value) => (
            <DropdownMenuRadioItem
              key={value}
              value={value}
              className="max-sm:min-h-11"
            >
              {UNIT_LABEL[value]}
              <span className="text-muted-foreground text-[10px]">
                {UNIT_HINT[value]}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator className="xl:hidden" />
        <DropdownMenuItem
          className="min-h-11 xl:hidden"
          onSelect={onOpenShortcuts}
        >
          <IconKeyboard />
          Keyboard shortcuts
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function Toolbar({ inspector }: { inspector?: ReactElement }) {
  const tool = useSelector(plannerStore, (s) => s.tool)
  const openingKind = useSelector(plannerStore, (s) => s.openingKind)
  const snap = useSelector(plannerStore, (s) => s.snap)
  const collide = useSelector(plannerStore, (s) => s.collide)
  const units = useSelector(plannerStore, (s) => s.units)
  const scale = useSelector(plannerStore, (s) => s.viewport.scale)
  const canUndo = useSelector(plannerStore, (s) => s.history.past.length > 0)
  const canRedo = useSelector(plannerStore, (s) => s.history.future.length > 0)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const actions = plannerStore.actions
  const navigate = useNavigate()

  return (
    <header className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] border-b xl:flex xl:h-11 xl:items-center xl:gap-2 xl:px-2">
      <div
        data-toolbar-section="plan"
        className="flex h-12 min-w-0 items-center gap-1 pl-2 sm:h-11 xl:h-auto xl:p-0"
      >
        <ProjectMenu />
        <SaveStatus />
        <Separator
          orientation="vertical"
          className="mx-1 hidden h-5 xl:block"
        />
      </div>

      <div
        data-toolbar-section="tools"
        className="order-3 col-span-2 flex h-12 min-w-0 items-center gap-1 overflow-x-auto border-t px-2 sm:h-11 xl:order-none xl:col-auto xl:h-auto xl:flex-1 xl:overflow-visible xl:border-0 xl:p-0 max-sm:gap-0"
      >
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
                className={`${SELECTED_TOOL} max-sm:size-11 max-sm:px-0`}
                aria-label={label}
              >
                <Icon />
              </ToggleGroupItem>
            </Hint>
          ))}
        </ToggleGroup>

        <OpeningMenu />

        {/* Openings are wall tools, kept adjacent at larger sizes. */}
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          className="hidden sm:flex"
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

        <FurnitureCatalogue />

        <Separator orientation="vertical" className="mx-1 h-5 max-sm:hidden" />

        <Hint label={`Snap to ${formatSnapStep(units)}`}>
          <Toggle
            variant="outline"
            size="sm"
            className={`${LONE_TOGGLE} max-sm:size-11 max-sm:px-0`}
            aria-label="Snap to grid"
            pressed={snap}
            onPressedChange={() => actions.toggleSnap()}
          >
            <IconMagnet />
          </Toggle>
        </Hint>

        {/* Collision remains in Options when its toolbar control is hidden. */}
        <Hint label="Keep furniture out of walls and other furniture">
          <Toggle
            variant="outline"
            size="sm"
            className={`${LONE_TOGGLE} max-sm:hidden`}
            aria-label="Collision"
            pressed={collide}
            onPressedChange={() => actions.toggleCollide()}
          >
            <IconBarrierBlock />
          </Toggle>
        </Hint>

        <div className="ml-auto flex shrink-0 items-center gap-0.5 max-sm:gap-0">
          <Hint label="Undo" keys={EDIT_KEYS.undo}>
            <Button
              variant="ghost"
              size="icon-sm"
              className="max-sm:size-11"
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
              className="max-sm:size-11"
              aria-label="Redo"
              disabled={!canRedo}
              onClick={() => actions.redo()}
            >
              <IconArrowForwardUp />
            </Button>
          </Hint>

          <div className="hidden items-center md:flex">
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
          </div>
        </div>
      </div>

      <div
        data-toolbar-section="actions"
        className="flex h-12 shrink-0 items-center gap-0.5 pr-2 sm:h-11 xl:h-auto xl:p-0"
      >
        <Hint label="Share this plan">
          <Button
            variant="outline"
            size="sm"
            className="max-sm:hidden"
            aria-label="Share this plan"
            onClick={() => void shareProject()}
          >
            <IconShare data-icon="inline-start" />
            <span className="max-sm:sr-only">Share</span>
          </Button>
        </Hint>
        <AIImportDialog className="max-sm:size-11 max-sm:px-0" />
        <UnderlayControl />
        <div className="xl:hidden">
          <FileMenu
            onProjectImported={(id) =>
              navigate({ to: '/p/$projectId', params: { projectId: id } })
            }
          />
        </div>
        <div className="hidden items-center gap-0.5 xl:flex">
          <ImportDialog
            trigger={
              <Button variant="outline" size="sm">
                <IconUpload data-icon="inline-start" />
                Import
              </Button>
            }
            onProjectImported={(id) =>
              navigate({ to: '/p/$projectId', params: { projectId: id } })
            }
          />
          <ExportMenu />
        </div>
        <Hint label="Keyboard shortcuts">
          <Button
            variant="ghost"
            size="icon-sm"
            className="hidden xl:inline-flex"
            aria-label="Keyboard shortcuts"
            onClick={() => setShortcutsOpen(true)}
          >
            <IconKeyboard />
          </Button>
        </Hint>
        <GitHubSync className="max-sm:size-11 max-sm:px-0" />
        {inspector}
        <OptionsMenu onOpenShortcuts={() => setShortcutsOpen(true)} />
      </div>
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </header>
  )
}
