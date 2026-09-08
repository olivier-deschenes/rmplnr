import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'

import {
  EnclosureFloor,
  FurnitureShape,
  OpeningShape,
  RoomFloor,
  RoomWalls,
} from './shapes.tsx'
import { UnderlayImage } from './underlay.tsx'
import { blobDataUrl, inlineSvgStyles } from './planImage.tsx'
import {
  EnclosureLabels,
  FurnitureLabels,
  RoomLabels,
  WallDimensions,
} from './overlay.tsx'

import { downloadFile, projectFileName } from '#/lib/planner/projectExport.ts'
import { furnitureNames, wallLabels } from '#/lib/planner/dimensions.ts'
import { freeEnclosures, planFloors } from '#/lib/planner/enclosures.ts'
import { planBounds } from '#/lib/planner/geometry.ts'
import { openingWall } from '#/lib/planner/openings.ts'
import { planWallPath } from '#/lib/planner/walls.ts'
import {
  PAPER_LABEL,
  SHEET_MARGIN,
  TITLE_BLOCK_HEIGHT,
  fittedScale,
  formatScale,
  inchesLabel,
  scaleBar,
  sheet,
  sheetViewport,
  unionRect,
} from '#/lib/planner/planSheet.ts'
import { formatArea } from '#/lib/planner/units.ts'

import type { Project, Rect, Units } from '#/lib/planner/types.ts'
import type { Underlay } from '#/lib/planner/underlay.ts'
import type { Orientation, PaperSize } from '#/lib/planner/planSheet.ts'

export type SheetOptions = {
  paper: PaperSize
  orientation: Orientation
  /** `null` fits the plan to the page at the tightest standard scale. */
  ratio: number | null
  /** Wall dimension labels, which a clean tracing copy does not want. */
  dimensions: boolean
  underlay: boolean
}

export const DEFAULT_SHEET_OPTIONS: SheetOptions = {
  paper: 'a4',
  orientation: 'landscape',
  ratio: null,
  dimensions: true,
  underlay: false,
}

function underlayRect(underlay?: Underlay): Rect | null {
  return underlay
    ? {
        x: underlay.x,
        y: underlay.y,
        w: underlay.width,
        h: underlay.height,
      }
    : null
}

const FALLBACK_EXTENT: Rect = { x: 0, y: 0, w: 400, h: 300 }

/** Everything the sheet has to hold, in plan centimetres. */
export function sheetExtent(project: Project, underlay?: Underlay): Rect {
  return (
    unionRect(
      planBounds(project.rooms, project.furniture),
      underlayRect(underlay),
    ) ?? FALLBACK_EXTENT
  )
}

/** The scale a sheet will actually be drawn at, fitted or chosen. */
export function resolvedScale(
  project: Project,
  units: Units,
  options: SheetOptions,
  underlay?: Underlay,
) {
  const page = sheet(options.paper, options.orientation)
  const extent = sheetExtent(project, underlay)
  return options.ratio === null
    ? fittedScale(extent, page.frame, units)
    : { ratio: options.ratio, label: formatScale(options.ratio, units) }
}

function ScaleBar({
  x,
  y,
  ratio,
  units,
}: {
  x: number
  y: number
  ratio: number
  units: Units
}) {
  const bar = scaleBar(ratio, units)
  const height = 4
  const half = bar.length / 2

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={bar.length}
        height={height}
        fill="#fff"
        stroke="#111"
        strokeWidth={0.5}
      />
      <rect x={x} y={y} width={half} height={height} fill="#111" />
      <text x={x} y={y - 3} fontSize={6} fill="#111" textAnchor="start">
        0
      </text>
      <text
        x={x + bar.length}
        y={y - 3}
        fontSize={6}
        fill="#111"
        textAnchor="end"
      >
        {bar.label}
      </text>
    </g>
  )
}

function TitleBlock({
  project,
  units,
  ratio,
  scaleLabel,
  paper,
  page,
}: {
  project: Project
  units: Units
  ratio: number
  scaleLabel: string
  paper: PaperSize
  page: { width: number; height: number }
}) {
  const top = page.height - SHEET_MARGIN - TITLE_BLOCK_HEIGHT
  const left = SHEET_MARGIN
  const right = page.width - SHEET_MARGIN
  const floors = planFloors(project.rooms, project.spaces)
  const printedOn = new Date().toLocaleDateString()

  return (
    <g fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace">
      <line
        x1={left}
        y1={top}
        x2={right}
        y2={top}
        stroke="#111"
        strokeWidth={0.75}
      />

      <text x={left} y={top + 14} fontSize={11} fill="#111" fontWeight="600">
        {project.name}
      </text>
      <text x={left} y={top + 26} fontSize={7} fill="#555">
        {floors.count} room{floors.count === 1 ? '' : 's'} ·{' '}
        {formatArea(floors.area, units)} · {project.furniture.length} item
        {project.furniture.length === 1 ? '' : 's'}
      </text>

      <text
        x={page.width / 2}
        y={top + 14}
        fontSize={11}
        fill="#111"
        textAnchor="middle"
        fontWeight="600"
      >
        Scale {scaleLabel}
      </text>
      <text
        x={page.width / 2}
        y={top + 26}
        fontSize={7}
        fill="#555"
        textAnchor="middle"
      >
        {inchesLabel(ratio, units)} · print at 100%
      </text>

      <ScaleBar
        x={right - scaleBar(ratio, units).length}
        y={top + 10}
        ratio={ratio}
        units={units}
      />
      <text x={right} y={top + 26} fontSize={7} fill="#555" textAnchor="end">
        {PAPER_LABEL[paper]} · rmplnr · {printedOn}
      </text>
    </g>
  )
}

/**
 * One plan on one sheet of paper, drawn at a stated scale.
 *
 * This is the editor's own SVG vocabulary — the same room, wall, opening and
 * label components the canvas uses — laid out against a page box in points
 * instead of a viewport in screen pixels. Nothing is rasterized, so the print
 * pipeline receives real lines and real text.
 */
export function PlanSheet({
  project,
  units,
  options,
  underlay,
  underlayHref,
}: {
  project: Project
  units: Units
  options: SheetOptions
  underlay?: Underlay
  underlayHref?: string
}) {
  const page = sheet(options.paper, options.orientation)
  const extent = sheetExtent(project, underlay)
  const scale = resolvedScale(project, units, options, underlay)
  const viewport = sheetViewport(extent, page.frame, scale.ratio)
  const clipId = 'plan-sheet-frame'

  const placed = project.openings.flatMap((opening) => {
    const wall = openingWall(project.rooms, opening)
    return wall ? [{ opening, wall }] : []
  })
  const enclosures = freeEnclosures(project.rooms, project.spaces)
  const dimensions = options.dimensions
    ? wallLabels(
        project.rooms,
        project.furniture,
        project.openings,
        viewport,
        units,
        page,
        enclosures,
      )
    : []
  const names = furnitureNames(
    project.rooms,
    project.furniture,
    viewport,
    units,
    enclosures,
  )

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="font-mono"
      width={page.width}
      height={page.height}
      viewBox={`0 0 ${page.width} ${page.height}`}
    >
      <defs>
        <clipPath id={clipId}>
          <rect
            x={page.frame.x}
            y={page.frame.y}
            width={page.frame.w}
            height={page.frame.h}
          />
        </clipPath>
      </defs>

      <rect x={0} y={0} width={page.width} height={page.height} fill="#fff" />

      <g clipPath={`url(#${clipId})`}>
        <g
          transform={`translate(${viewport.tx} ${viewport.ty}) scale(${viewport.scale})`}
        >
          {underlay && underlayHref && (
            <UnderlayImage
              underlay={{ ...underlay, visible: true }}
              href={underlayHref}
            />
          )}
          {project.rooms.map((room) => (
            <RoomFloor
              key={room.id}
              room={room}
              selected={false}
              onPointerDown={() => undefined}
            />
          ))}
          {enclosures.map((enclosure) => (
            <EnclosureFloor
              key={enclosure.key}
              enclosure={enclosure}
              hint={false}
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
          <RoomWalls
            d={planWallPath(project.rooms, project.openings)}
            scale={viewport.scale}
          />
          {placed.map(({ opening, wall }) => (
            <OpeningShape key={opening.id} opening={opening} wall={wall} />
          ))}
        </g>

        <RoomLabels rooms={project.rooms} viewport={viewport} units={units} />
        <EnclosureLabels
          enclosures={enclosures}
          viewport={viewport}
          units={units}
        />
        <FurnitureLabels labels={names} />
        <WallDimensions labels={dimensions} />
      </g>

      <TitleBlock
        project={project}
        units={units}
        ratio={scale.ratio}
        scaleLabel={scale.label}
        paper={options.paper}
        page={page}
      />
    </svg>
  )
}

// --- output ----------------------------------------------------------------

const SVG_TYPE = 'image/svg+xml;charset=utf-8'

/**
 * Render the sheet outside the editor, hand the live element to `use`, and take
 * it down again. The element has to be in the document — not just in memory —
 * because the export reads back the styles the browser computed for it.
 */
async function withRenderedSheet<T>(
  project: Project,
  units: Units,
  options: SheetOptions,
  underlay: Underlay | undefined,
  use: (svg: SVGSVGElement) => Promise<T> | T,
): Promise<T> {
  const host = document.createElement('div')
  host.style.position = 'fixed'
  host.style.left = '-10000px'
  host.style.top = '0'
  host.style.pointerEvents = 'none'
  document.body.append(host)

  const root = createRoot(host)
  try {
    const underlayHref = underlay ? await blobDataUrl(underlay.blob) : undefined
    flushSync(() =>
      root.render(
        <PlanSheet
          project={project}
          units={units}
          options={options}
          underlay={underlay}
          underlayHref={underlayHref}
        />,
      ),
    )
    const svg = host.querySelector('svg')
    if (!svg) throw new Error('Could not prepare the plan sheet.')
    await document.fonts.ready
    return await use(svg)
  } finally {
    root.unmount()
    host.remove()
  }
}

/** A standalone SVG document: styles inlined, nothing left pointing outward. */
function serializeSheet(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement
  inlineSvgStyles(svg, clone)
  clone.removeAttribute('class')
  return new XMLSerializer().serializeToString(clone)
}

/** Save the sheet as vector SVG, which every drawing tool can reopen. */
export async function downloadPlanSheetSvg(
  project: Project,
  units: Units,
  options: SheetOptions,
  underlay?: Underlay,
): Promise<void> {
  const markup = await withRenderedSheet(
    project,
    units,
    options,
    underlay,
    serializeSheet,
  )
  downloadFile(
    new Blob([markup], { type: SVG_TYPE }),
    projectFileName(project, 'svg'),
  )
}

/**
 * The @font-face rules and any other document styles, so the print frame draws
 * the sheet in the same hand the editor does. `srcdoc` keeps the parent's base
 * URL, so relative stylesheet links still resolve.
 */
function documentStyles(): string {
  return Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
    .map((node) => node.outerHTML)
    .join('\n')
}

function printableDocument(
  markup: string,
  title: string,
  page: { width: number; height: number },
): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${title.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))}</title>
${documentStyles()}
<style>
  @page { size: ${page.width}pt ${page.height}pt; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  svg { display: block; width: ${page.width}pt; height: ${page.height}pt; }
  @media print { html, body { width: ${page.width}pt; height: ${page.height}pt; } }
</style>
</head>
<body>${markup}</body>
</html>`
}

/**
 * Hold the print frame open until the dialog is done with it.
 *
 * `print()` blocks until the dialog closes on Chrome and Firefox but returns
 * straight away on Safari, so the frame is torn down on `afterprint` instead.
 * The timer is only there so a dialog that never reports back cannot leak it.
 */
function printed(view: Window): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      resolve()
    }
    const timer = window.setTimeout(finish, 120_000)
    view.addEventListener('afterprint', finish, { once: true })
    view.focus()
    view.print()
  })
}

/**
 * Send the sheet to the browser's print pipeline, page box and all.
 *
 * The output is a real vector PDF because the browser's own PDF writer receives
 * the same lines and text the editor drew, rather than a picture of them. The
 * page is declared in points and the margin is zero, so "Save as PDF" at 100%
 * produces paper a ruler agrees with.
 */
export async function printPlanSheet(
  project: Project,
  units: Units,
  options: SheetOptions,
  underlay?: Underlay,
): Promise<void> {
  const page = sheet(options.paper, options.orientation)
  const markup = await withRenderedSheet(
    project,
    units,
    options,
    underlay,
    serializeSheet,
  )
  const html = printableDocument(markup, project.name, page)

  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.title = 'Plan sheet for printing'
  frame.style.position = 'fixed'
  frame.style.right = '0'
  frame.style.bottom = '0'
  frame.style.width = '1px'
  frame.style.height = '1px'
  frame.style.opacity = '0'
  frame.style.border = '0'
  document.body.append(frame)

  try {
    await new Promise<void>((resolve, reject) => {
      frame.onload = () => resolve()
      frame.onerror = () =>
        reject(new Error('Could not prepare the plan sheet.'))
      frame.srcdoc = html
    })

    const view = frame.contentWindow
    if (!view) throw new Error('Could not prepare the plan sheet.')
    await view.document.fonts.ready
    await printed(view)
  } finally {
    frame.remove()
  }
}
