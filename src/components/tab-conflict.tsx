import { useSelector } from '@tanstack/react-store'

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

import { keepThisTab, plannerStore, takeOtherTab } from '#/lib/planner/store.ts'

/** The plans at issue, read out the way somebody would say them aloud. */
function listed(names: Array<string>): string {
  if (names.length === 1) return names[0]
  const last = names[names.length - 1]
  return `${names.slice(0, -1).join(', ')} and ${last}`
}

/**
 * The one question two tabs cannot settle between themselves.
 *
 * Plans live in this browser, so two tabs are two people editing the same
 * paper: everything either of them did alone is merged and nothing is said,
 * and this is only for a plan they both drew on since they last agreed. There
 * is no answer that keeps both versions, so the choice is put plainly and
 * saving stops until it is made — every further edit made in the meantime
 * would be one more thing riding on it.
 *
 * There is no way out but the two buttons, on purpose: dismissing it would
 * leave the tab quietly not saving, which is the failure it is here to stop.
 */
export function TabConflictDialog() {
  const conflict = useSelector(plannerStore, (s) => s.conflict)
  if (!conflict) return null

  const names = conflict.plans.map((plan) => plan.name)
  const one = names.length === 1

  return (
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {one
              ? `${names[0]} was changed in another tab`
              : 'Plans were changed in another tab'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {one
              ? 'It has been drawn on in both tabs since they last agreed, so only one of the two versions can be kept.'
              : `${listed(names)} have been drawn on in both tabs since they last agreed, so only one version of each can be kept.`}{' '}
            Nothing is being saved until you choose.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel size="sm" onClick={() => takeOtherTab()}>
            Use the other tab
          </AlertDialogCancel>
          <AlertDialogAction size="sm" onClick={() => keepThisTab()}>
            Keep this tab
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
