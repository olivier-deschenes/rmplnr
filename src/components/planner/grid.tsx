import { GRID_MAJOR, GRID_MINOR } from '#/lib/planner/types.ts'

import type { Viewport } from '#/lib/planner/types.ts'

/**
 * Grid lines are drawn in screen space: the pattern tile is sized in pixels and
 * offset by the pan, so strokes stay exactly 1px crisp at any zoom. The 10cm
 * grid is dropped once it gets too dense to read.
 */
export function Grid({ viewport }: { viewport: Viewport }) {
  const minor = GRID_MINOR * viewport.scale
  const major = GRID_MAJOR * viewport.scale
  const showMinor = minor >= 8

  return (
    <>
      <defs>
        <pattern
          id="grid-minor"
          patternUnits="userSpaceOnUse"
          width={minor}
          height={minor}
          patternTransform={`translate(${viewport.tx % minor} ${viewport.ty % minor})`}
        >
          <path
            d={`M ${minor} 0 L 0 0 0 ${minor}`}
            fill="none"
            className="stroke-foreground/12"
            strokeWidth={1}
          />
        </pattern>
        <pattern
          id="grid-major"
          patternUnits="userSpaceOnUse"
          width={major}
          height={major}
          patternTransform={`translate(${viewport.tx % major} ${viewport.ty % major})`}
        >
          <path
            d={`M ${major} 0 L 0 0 0 ${major}`}
            fill="none"
            className="stroke-foreground/28"
            strokeWidth={1}
          />
        </pattern>
      </defs>
      {showMinor && <rect width="100%" height="100%" fill="url(#grid-minor)" />}
      <rect width="100%" height="100%" fill="url(#grid-major)" />
    </>
  )
}
