import { useEffect, useState } from 'react'

import type { Underlay } from '#/lib/planner/underlay.ts'

/** A stable browser URL for a Blob, revoked as soon as it is no longer shown. */
export function useBlobUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!blob) {
      setUrl(null)
      return
    }
    const next = URL.createObjectURL(blob)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [blob])

  return url
}

/**
 * The trace is always below plan geometry and never receives pointer events.
 * Its only editable moment is the canvas-wide positioning mode owned by the
 * editor, so a normal click can never select or disturb it.
 */
export function UnderlayImage({
  underlay,
  href,
  positioning = false,
  scale = 1,
}: {
  underlay: Underlay
  href: string
  positioning?: boolean
  scale?: number
}) {
  if (!underlay.visible && !positioning) return null

  return (
    <g className="pointer-events-none" data-plan-underlay>
      <image
        href={href}
        x={underlay.x}
        y={underlay.y}
        width={underlay.width}
        height={underlay.height}
        opacity={underlay.visible ? underlay.opacity : 0.15}
        preserveAspectRatio="none"
      />
      {positioning && (
        <rect
          x={underlay.x}
          y={underlay.y}
          width={underlay.width}
          height={underlay.height}
          fill="none"
          stroke="currentColor"
          strokeWidth={1 / scale}
          strokeDasharray={`${6 / scale} ${4 / scale}`}
          className="text-foreground"
        />
      )}
    </g>
  )
}
