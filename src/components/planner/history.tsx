import { useSelector } from '@tanstack/react-store'

import { cn } from '#/lib/utils.ts'
import { plannerStore } from '#/lib/planner/store.ts'
import { recentActions } from '#/lib/planner/history.ts'

/**
 * The last changes made to the plan, newest first.
 *
 * It reads off the undo stack rather than keeping a record of its own, so the
 * list can never drift from what an undo would actually take back: undoing
 * lifts a change off the list, where it stays greyed out for as long as a redo
 * could put it back. Navigating — panning, zooming, selecting — leaves no mark
 * here, the same way it leaves nothing to undo.
 */
export function HistoryPanel() {
  const history = useSelector(plannerStore, (s) => s.history)
  const planIsEmpty = useSelector(
    plannerStore,
    (s) =>
      s.rooms.length === 0 &&
      s.furniture.length === 0 &&
      s.openings.length === 0,
  )
  const actions = recentActions(history)
  // The change the plan currently stands on, which is the one undo would take.
  const current = actions.findIndex((action) => !action.undone)

  return (
    <section className="flex max-h-[35%] shrink-0 flex-col gap-3 border-t p-4">
      <h2 className="text-sm font-medium">History</h2>
      {actions.length === 0 ? (
        <p className="text-muted-foreground text-[13px] leading-relaxed">
          {planIsEmpty
            ? 'Nothing yet. Draw a room to start.'
            : 'No edits this session'}
        </p>
      ) : (
        <ol className="grid content-start gap-2 overflow-y-auto text-xs leading-relaxed">
          {actions.map((action, index) => (
            <li
              key={`${index}-${action.text}`}
              className="flex items-center gap-2"
            >
              <span
                className={cn(
                  'size-1.5 shrink-0 rounded-full border',
                  action.undone
                    ? 'border-muted-foreground/40'
                    : index === current
                      ? 'border-foreground bg-foreground'
                      : 'border-muted-foreground/60 bg-muted-foreground/60',
                )}
              />
              <span
                className={cn(
                  'truncate',
                  action.undone
                    ? 'text-muted-foreground/50 line-through'
                    : index === current
                      ? 'text-foreground'
                      : 'text-muted-foreground',
                )}
              >
                {action.text}
              </span>
              {action.count > 1 && (
                <span className="text-muted-foreground ml-auto shrink-0 tabular-nums">
                  ×{action.count}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
