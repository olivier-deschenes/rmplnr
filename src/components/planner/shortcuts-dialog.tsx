import { formatForDisplay } from '@tanstack/react-hotkeys'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog.tsx'
import { Kbd } from '#/components/ui/kbd.tsx'

import { EDIT_KEYS, OPENING_KEYS, TOOL_KEYS } from '#/lib/planner/shortcuts.ts'

import type { Hotkey } from '@tanstack/react-hotkeys'

type Shortcut = {
  label: string
  hotkey?: Hotkey
  display?: string
  suffix?: string
}

type ShortcutGroup = { label: string; shortcuts: Array<Shortcut> }

export const SHORTCUT_GROUPS: Array<ShortcutGroup> = [
  {
    label: 'Drawing',
    shortcuts: [
      { label: 'Select', hotkey: TOOL_KEYS.select },
      { label: 'Rectangle room', hotkey: TOOL_KEYS.rect },
      { label: 'Custom outline', hotkey: TOOL_KEYS.room },
      { label: 'Door', hotkey: OPENING_KEYS.door },
      { label: 'Window', hotkey: OPENING_KEYS.window },
      { label: 'Opening', hotkey: OPENING_KEYS.opening },
    ],
  },
  {
    label: 'Editing',
    shortcuts: [
      { label: 'Undo', hotkey: EDIT_KEYS.undo },
      { label: 'Redo', hotkey: EDIT_KEYS.redo },
      { label: 'Copy', hotkey: EDIT_KEYS.copy },
      { label: 'Paste', hotkey: EDIT_KEYS.paste },
      { label: 'Duplicate', hotkey: EDIT_KEYS.duplicate },
      { label: 'Delete or remove last corner', hotkey: EDIT_KEYS.remove },
      { label: 'Finish outline', hotkey: EDIT_KEYS.commit },
      { label: 'Cancel current action', hotkey: EDIT_KEYS.cancel },
    ],
  },
  {
    label: 'Moving around',
    shortcuts: [
      { label: 'Pan from anywhere', hotkey: EDIT_KEYS.pan, suffix: '+ drag' },
      { label: 'Nudge selection', display: 'Arrow keys' },
      { label: 'Larger nudge', display: 'Shift + Arrow keys' },
    ],
  },
]

function ShortcutKeys({ shortcut }: { shortcut: Shortcut }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      <Kbd>
        {shortcut.hotkey ? formatForDisplay(shortcut.hotkey) : shortcut.display}
      </Kbd>
      {shortcut.suffix && (
        <span className="text-muted-foreground">{shortcut.suffix}</span>
      )}
    </span>
  )
}

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Work faster without leaving the canvas. Mod means Command on macOS
            and Control on Windows or Linux.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 sm:grid-cols-3">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.label} className="grid content-start gap-2">
              <h3 className="font-heading text-xs font-medium">
                {group.label}
              </h3>
              <dl className="grid gap-2">
                {group.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.label}
                    className="flex items-center justify-between gap-3"
                  >
                    <dt className="text-muted-foreground">{shortcut.label}</dt>
                    <dd>
                      <ShortcutKeys shortcut={shortcut} />
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
