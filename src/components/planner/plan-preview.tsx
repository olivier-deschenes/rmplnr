import {
  FurnitureShape,
  OpeningShape,
  RoomFloor,
  RoomWalls,
} from './shapes.tsx'
import { planBounds } from '#/lib/planner/geometry.ts'
import { openingWall } from '#/lib/planner/openings.ts'
import { wallPath } from '#/lib/planner/walls.ts'
import type { Project } from '#/lib/planner/types.ts'

/** Saved geometry, drawn with the same shapes as the editor. */
export function PlanPreview({ project }: { project: Project }) {
  const bounds = planBounds(project.rooms, project.furniture)
  if (!bounds)
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center gap-2 text-xs">
        <span
          className="size-8 rounded-sm border border-dashed border-current/40"
          aria-hidden="true"
        />
        Ready to draw
      </div>
    )
  const width = 360
  const height = 216
  const scale = Math.min(
    304 / Math.max(bounds.w, 1),
    160 / Math.max(bounds.h, 1),
  )
  const tx = width / 2 - (bounds.x + bounds.w / 2) * scale
  const ty = height / 2 - (bounds.y + bounds.h / 2) * scale
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="pointer-events-none h-full w-full"
      aria-hidden="true"
    >
      <g transform={`translate(${tx} ${ty}) scale(${scale})`}>
        {project.rooms.map((room) => (
          <RoomFloor
            key={room.id}
            room={room}
            selected={false}
            onPointerDown={() => undefined}
          />
        ))}
        {project.furniture.map((item) => (
          <FurnitureShape
            key={item.id}
            item={item}
            selected={false}
            onPointerDown={() => undefined}
          />
        ))}
        {project.rooms.map((room) => (
          <RoomWalls
            key={room.id}
            d={wallPath(project.rooms, project.openings, room)}
            scale={scale}
          />
        ))}
        {project.openings.map((opening) => {
          const wall = openingWall(project.rooms, opening)
          return wall ? (
            <OpeningShape key={opening.id} opening={opening} wall={wall} />
          ) : null
        })}
      </g>
    </svg>
  )
}
