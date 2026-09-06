import { Link } from '@tanstack/react-router'

import { Button } from '#/components/ui/button.tsx'

export function NotFoundPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-6 py-16">
      <header className="grid gap-1">
        <p className="text-sm">rmplnr</p>
        <p className="text-muted-foreground text-[11px]">
          Draw a room, and what goes in it.
        </p>
      </header>

      <section className="grid gap-3">
        <p className="text-muted-foreground text-[10px] tracking-wider uppercase">
          404
        </p>
        <div className="grid gap-1">
          <h1 className="text-sm">Page not found</h1>
          <p className="text-muted-foreground text-[11px] leading-relaxed">
            That address may be old or mistyped. Your saved plans are still in
            this browser.
          </p>
        </div>
      </section>

      <Button asChild variant="outline" size="sm" className="self-start">
        <Link to="/projects">All plans</Link>
      </Button>
    </main>
  )
}
