import { Spinner } from '#/components/ui/spinner.tsx'

export function PageLoading({ label }: { label: string }) {
  return (
    <main
      data-slot="page-loading"
      aria-busy="true"
      className="grid min-h-dvh place-items-center"
    >
      <div
        role="status"
        className="text-muted-foreground flex items-center gap-2 text-[11px]"
      >
        <Spinner role="presentation" aria-hidden="true" className="size-3.5" />
        <span>{label}</span>
      </div>
    </main>
  )
}
