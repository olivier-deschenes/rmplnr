import {
  FurnitureShape,
  OpeningShape,
  RoomFloor,
  RoomWalls,
} from './shapes.tsx'
import { freeEnclosures } from '#/lib/planner/enclosures.ts'
import { planBounds, polygonCentroid } from '#/lib/planner/geometry.ts'
import { openingWall } from '#/lib/planner/openings.ts'
import { formatLength } from '#/lib/planner/units.ts'
import { wallPath } from '#/lib/planner/walls.ts'
import type { Project, Units } from '#/lib/planner/types.ts'

/** Saved geometry, drawn with the same shapes as the editor. */
export function PlanPreview({
  project,
  annotated = false,
  showFurniture = true,
  units = 'metric',
}: {
  project: Project
  annotated?: boolean
  showFurniture?: boolean
  units?: Units
}) {
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
  const width = annotated ? 480 : 360
  const height = annotated ? 428 : 216
  const scale = Math.min(
    (annotated ? 384 : 304) / Math.max(bounds.w, 1),
    (annotated ? 316 : 160) / Math.max(bounds.h, 1),
  )
  const tx = width / 2 - (bounds.x + bounds.w / 2) * scale
  const ty = height / 2 - (bounds.y + bounds.h / 2) * scale
  const left = tx + bounds.x * scale
  const top = ty + bounds.y * scale
  const right = left + bounds.w * scale
  const bottom = top + bounds.h * scale
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="pointer-events-none h-full w-full"
      aria-hidden={annotated ? undefined : true}
      role={annotated ? 'img' : undefined}
      aria-label={
        annotated
          ? `${project.name}, ${showFurniture ? 'furnished' : 'unfurnished'} floor plan, ${formatLength(bounds.w, units)} by ${formatLength(bounds.h, units)}`
          : undefined
      }
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
        {showFurniture &&
          project.furniture.map((item) => (
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
      {annotated && (
        <g className="font-mono text-xs">
          <path
            d={`M ${left} ${top - 12} V ${top - 32} M ${right} ${top - 12} V ${top - 32} M ${left} ${top - 24} H ${right} M ${right + 12} ${top} H ${right + 32} M ${right + 12} ${bottom} H ${right + 32} M ${right + 24} ${top} V ${bottom}`}
            className="stroke-muted-foreground/50"
            fill="none"
            strokeWidth={0.75}
          />
          <text
            x={width / 2}
            y={top - 34}
            textAnchor="middle"
            className="fill-muted-foreground"
          >
            {formatLength(bounds.w, units)}
          </text>
          <text
            transform={`translate(${right + 40} ${height / 2}) rotate(90)`}
            textAnchor="middle"
            className="fill-muted-foreground"
          >
            {formatLength(bounds.h, units)}
          </text>
          {!showFurniture &&
            project.rooms
              .filter((room) => room.closed !== false)
              .map((room) => {
                const centre = polygonCentroid(room.points)
                return (
                  <text
                    key={room.id}
                    x={tx + centre.x * scale}
                    y={ty + centre.y * scale}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="fill-muted-foreground"
                  >
                    {room.name}
                  </text>
                )
              })}
          {!showFurniture &&
            freeEnclosures(project.rooms, project.spaces)
              .filter((enclosure) => enclosure.space)
              .map((enclosure) => (
                <text
                  key={enclosure.key}
                  x={tx + enclosure.centre.x * scale}
                  y={ty + enclosure.centre.y * scale}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="fill-muted-foreground"
                >
                  {enclosure.space?.name}
                </text>
              ))}
        </g>
      )}
    </svg>
  )
}
