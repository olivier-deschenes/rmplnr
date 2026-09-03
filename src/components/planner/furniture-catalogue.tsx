import { useId, useState } from 'react'
import { useSelector } from '@tanstack/react-store'
import {
  IconArmchair,
  IconArrowLeft,
  IconBed,
  IconBorderAll,
  IconBox,
  IconBuildingArch,
  IconCooker,
  IconDesk,
  IconDeviceTv,
  IconFridge,
  IconGrill,
  IconHanger,
  IconLayoutRows,
  IconPlus,
  IconSearch,
  IconSettings,
  IconSofa,
  IconTable,
  IconTrash,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog.tsx'
import { Input } from '#/components/ui/input.tsx'
import { Label } from '#/components/ui/label.tsx'
import {
  FURNITURE_CATEGORIES,
  FURNITURE_CATEGORY_LABELS,
  FURNITURE_KINDS,
  FURNITURE_PRESETS,
} from '#/lib/planner/presets.ts'
import { plannerStore } from '#/lib/planner/store.ts'
import { formatSize } from '#/lib/planner/units.ts'

import type { TablerIcon } from '@tabler/icons-react'
import type {
  CustomFurniturePreset,
  FurnitureKind,
  Units,
} from '#/lib/planner/types.ts'

const FURNITURE_ICONS: Record<FurnitureKind, TablerIcon> = {
  table: IconTable,
  sofa: IconSofa,
  bed: IconBed,
  desk: IconDesk,
  chair: IconArmchair,
  dresser: IconLayoutRows,
  tv: IconDeviceTv,
  kitchen: IconCooker,
  appliance: IconFridge,
  radiator: IconGrill,
  column: IconBuildingArch,
  rug: IconBorderAll,
  box: IconBox,
}

function dimensions(
  footprint: Pick<CustomFurniturePreset, 'w' | 'h' | 'collides'>,
  units: Units,
): string {
  const size = formatSize(footprint.w, footprint.h, units)
  return footprint.collides ? size : `${size} · overlap allowed`
}

function matches(query: string, ...parts: Array<string | undefined>): boolean {
  const needle = query.trim().toLowerCase()
  return needle.length === 0 || parts.join(' ').toLowerCase().includes(needle)
}

function CatalogueChoice({
  icon: Icon,
  label,
  detail,
  onChoose,
}: {
  icon: TablerIcon
  label: string
  detail: string
  onChoose: () => void
}) {
  return (
    <Button
      variant="ghost"
      className="h-auto min-h-12 w-full justify-start gap-3 px-2 py-2 text-left whitespace-normal"
      onClick={onChoose}
    >
      <Icon className="text-muted-foreground size-4" />
      <span className="grid min-w-0 gap-0.5">
        <span className="truncate">{label}</span>
        <span className="text-muted-foreground text-[10px] font-normal tabular-nums">
          {detail}
        </span>
      </span>
    </Button>
  )
}

function PresetEditor({
  preset,
  units,
  onDelete,
}: {
  preset: CustomFurniturePreset
  units: Units
  onDelete: () => void
}) {
  const id = useId()
  const [name, setName] = useState(preset.name)
  const [error, setError] = useState<string | null>(null)

  const commit = () => {
    const trimmed = name.trim()
    if (!plannerStore.actions.renameFurniturePreset(preset.id, trimmed)) {
      setError('Enter a preset name.')
      return
    }
    setName(trimmed)
    setError(null)
  }

  return (
    <li className="grid gap-1 border-t py-3 first:border-t-0 first:pt-0">
      <div className="flex items-center gap-2">
        <Label htmlFor={id} className="sr-only">
          Preset name
        </Label>
        <Input
          id={id}
          value={name}
          maxLength={80}
          aria-invalid={error !== null}
          aria-describedby={error ? `${id}-error` : `${id}-detail`}
          onChange={(event) => {
            setName(event.target.value)
            setError(null)
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              setName(preset.name)
              setError(null)
            }
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Delete ${preset.name}`}
          onClick={onDelete}
        >
          <IconTrash />
        </Button>
      </div>
      <p
        id={`${id}-detail`}
        className="text-muted-foreground text-[10px] tabular-nums"
      >
        {FURNITURE_PRESETS[preset.kind].label} · {dimensions(preset, units)}
      </p>
      {error ? (
        <p
          id={`${id}-error`}
          role="alert"
          className="text-destructive text-[10px]"
        >
          {error}
        </p>
      ) : null}
    </li>
  )
}

/** Searchable furniture catalogue and local custom-preset manager. */
export function FurnitureCatalogue() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [managing, setManaging] = useState(false)
  const [deleting, setDeleting] = useState<CustomFurniturePreset | null>(null)
  const tool = useSelector(plannerStore, (state) => state.tool)
  const units = useSelector(plannerStore, (state) => state.units)
  const custom = useSelector(
    plannerStore,
    (state) => state.customFurniturePresets,
  )

  const reset = () => {
    setQuery('')
    setManaging(false)
  }
  const close = () => {
    setOpen(false)
    reset()
  }
  const chooseBuiltIn = (kind: FurnitureKind) => {
    plannerStore.actions.addFurniture(kind)
    close()
  }
  const chooseCustom = (id: string) => {
    plannerStore.actions.addCustomFurniture(id)
    close()
  }
  const chooseCloset = () => {
    plannerStore.actions.setTool('closet')
    close()
  }

  const shownCustom = custom.filter((preset) =>
    matches(query, preset.name, FURNITURE_PRESETS[preset.kind].label, 'custom'),
  )
  const shownBuiltIns = FURNITURE_KINDS.filter((kind) => {
    const preset = FURNITURE_PRESETS[kind]
    return matches(
      query,
      preset.label,
      kind,
      FURNITURE_CATEGORY_LABELS[preset.category],
      preset.keywords,
    )
  })
  const closetShown = matches(query, 'closet', 'wardrobe', 'built-in storage')
  const empty =
    shownCustom.length === 0 && shownBuiltIns.length === 0 && !closetShown

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) reset()
        }}
      >
        <DialogTrigger asChild>
          <Button
            variant={tool === 'closet' ? 'default' : 'outline'}
            size="sm"
            className="max-sm:size-11 max-sm:px-0"
            aria-label="Add furniture or a closet"
          >
            <IconPlus data-icon="inline-start" />
            <span className="max-sm:sr-only">Add</span>
          </Button>
        </DialogTrigger>
        <DialogContent className="grid max-h-[min(90vh,44rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {managing ? 'Custom presets' : 'Add to plan'}
            </DialogTitle>
            <DialogDescription>
              {managing
                ? 'Rename or delete footprints saved from the inspector.'
                : 'Choose a measured footprint, then resize or rename it in the inspector.'}
            </DialogDescription>
          </DialogHeader>

          {managing ? (
            <div className="min-h-0 overflow-y-auto pr-1">
              {custom.length === 0 ? (
                <p className="text-muted-foreground py-8 text-center">
                  Select furniture in a plan and choose Save as custom preset.
                </p>
              ) : (
                <ul>
                  {custom.map((preset) => (
                    <PresetEditor
                      key={preset.id}
                      preset={preset}
                      units={units}
                      onDelete={() => setDeleting(preset)}
                    />
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
              <div className="relative">
                <IconSearch className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2" />
                <Input
                  value={query}
                  className="pl-8"
                  aria-label="Search furniture"
                  placeholder="Search furniture"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <div className="min-h-0 overflow-y-auto pr-1">
                {shownCustom.length > 0 ? (
                  <section
                    className="grid gap-1 pb-4"
                    aria-labelledby="custom-presets-heading"
                  >
                    <h3
                      id="custom-presets-heading"
                      className="px-2 text-xs font-medium"
                    >
                      Custom presets
                    </h3>
                    <div className="grid gap-1 sm:grid-cols-2">
                      {shownCustom.map((preset) => {
                        const Icon = FURNITURE_ICONS[preset.kind]
                        return (
                          <CatalogueChoice
                            key={preset.id}
                            icon={Icon}
                            label={preset.name}
                            detail={dimensions(preset, units)}
                            onChoose={() => chooseCustom(preset.id)}
                          />
                        )
                      })}
                    </div>
                  </section>
                ) : null}

                {closetShown ? (
                  <section
                    className="grid gap-1 pb-4"
                    aria-labelledby="built-in-heading"
                  >
                    <h3
                      id="built-in-heading"
                      className="px-2 text-xs font-medium"
                    >
                      Built-in
                    </h3>
                    <div className="grid gap-1 sm:grid-cols-2">
                      <CatalogueChoice
                        icon={IconHanger}
                        label="Closet"
                        detail="Attach to a room wall"
                        onChoose={chooseCloset}
                      />
                    </div>
                  </section>
                ) : null}

                {FURNITURE_CATEGORIES.map((category) => {
                  const kinds = shownBuiltIns.filter(
                    (kind) => FURNITURE_PRESETS[kind].category === category,
                  )
                  if (kinds.length === 0) return null
                  const heading = `furniture-${category}-heading`
                  return (
                    <section
                      key={category}
                      className="grid gap-1 pb-4"
                      aria-labelledby={heading}
                    >
                      <h3 id={heading} className="px-2 text-xs font-medium">
                        {FURNITURE_CATEGORY_LABELS[category]}
                      </h3>
                      <div className="grid gap-1 sm:grid-cols-2">
                        {kinds.map((kind) => {
                          const preset = FURNITURE_PRESETS[kind]
                          const Icon = FURNITURE_ICONS[kind]
                          return (
                            <CatalogueChoice
                              key={kind}
                              icon={Icon}
                              label={preset.label}
                              detail={dimensions(preset, units)}
                              onChoose={() => chooseBuiltIn(kind)}
                            />
                          )
                        })}
                      </div>
                    </section>
                  )
                })}

                {empty ? (
                  <p className="text-muted-foreground py-8 text-center">
                    No furniture matches “{query.trim()}”.
                  </p>
                ) : null}
              </div>
            </div>
          )}

          <DialogFooter className="border-t pt-3 sm:justify-start">
            {managing ? (
              <Button variant="outline" onClick={() => setManaging(false)}>
                <IconArrowLeft data-icon="inline-start" />
                Back to catalogue
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setManaging(true)}>
                <IconSettings data-icon="inline-start" />
                Custom presets
                {custom.length > 0 ? ` (${custom.length})` : ''}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Existing furniture stays in its plans. This only removes the
              reusable preset.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
            <AlertDialogAction
              size="sm"
              variant="destructive"
              onClick={() => {
                if (deleting) {
                  plannerStore.actions.deleteFurniturePreset(deleting.id)
                }
                setDeleting(null)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
