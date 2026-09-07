import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'

import {
  FurnitureShape,
  OpeningShape,
  RoomFloor,
  RoomWalls,
} from './shapes.tsx'
import { UnderlayImage } from './underlay.tsx'
import { FurnitureLabels, RoomLabels, WallDimensions } from './overlay.tsx'

import { downloadFile, projectFileName } from '#/lib/planner/projectExport.ts'
import { furnitureNames, wallLabels } from '#/lib/planner/dimensions.ts'
import { planBounds } from '#/lib/planner/geometry.ts'
import { openingWall } from '#/lib/planner/openings.ts'
import { wallPath } from '#/lib/planner/walls.ts'

import type { Project, Rect, Units, Viewport } from '#/lib/planner/types.ts'
import type { Underlay } from '#/lib/planner/underlay.ts'

const LONG_EDGE = 1600
const SHORT_EDGE = 600
const LAYOUT_PADDING = 96
const CROP_PADDING = 32
const MAX_RASTER_EDGE = 4096

const SVG_STYLE_PROPERTIES = [
  'dominant-baseline',
  'fill',
  'fill-opacity',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'letter-spacing',
  'opacity',
  'paint-order',
  'stroke',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-opacity',
  'stroke-width',
  'text-anchor',
] as const

type ImageSize = { width: number; height: number }

function joinedBounds(plan: Rect | null, underlay?: Underlay): Rect | null {
  if (!underlay) return plan
  const background = {
    x: underlay.x,
    y: underlay.y,
    w: underlay.width,
    h: underlay.height,
  }
  if (!plan) return background
  const x = Math.min(plan.x, background.x)
  const y = Math.min(plan.y, background.y)
  const right = Math.max(plan.x + plan.w, background.x + background.w)
  const bottom = Math.max(plan.y + plan.h, background.y + background.h)
  return { x, y, w: right - x, h: bottom - y }
}

/** A large, useful image shape that follows the plan without becoming extreme. */
export function planImageSize(
  project: Project,
  underlay?: Underlay,
): ImageSize {
  const bounds = joinedBounds(
    planBounds(project.rooms, project.furniture),
    underlay,
  )
  if (!bounds) return { width: 1200, height: 900 }

  const aspect = Math.min(4, Math.max(0.25, bounds.w / Math.max(bounds.h, 1)))
  return aspect >= 1
    ? {
        width: LONG_EDGE,
        height: Math.max(SHORT_EDGE, Math.round(LONG_EDGE / aspect)),
      }
    : {
        width: Math.max(SHORT_EDGE, Math.round(LONG_EDGE * aspect)),
        height: LONG_EDGE,
      }
}

function imageViewport(bounds: Rect | null, size: ImageSize): Viewport {
  if (!bounds) {
    return { tx: size.width / 2, ty: size.height / 2, scale: 1 }
  }

  const scale = Math.min(
    (size.width - LAYOUT_PADDING * 2) / Math.max(bounds.w, 1),
    (size.height - LAYOUT_PADDING * 2) / Math.max(bounds.h, 1),
  )
  return {
    scale,
    tx: size.width / 2 - (bounds.x + bounds.w / 2) * scale,
    ty: size.height / 2 - (bounds.y + bounds.h / 2) * scale,
  }
}

function PlanImage({
  project,
  units,
  underlay,
  underlayHref,
}: {
  project: Project
  units: Units
  underlay?: Underlay
  underlayHref?: string
}) {
  const bounds = joinedBounds(
    planBounds(project.rooms, project.furniture),
    underlay,
  )
  const size = planImageSize(project, underlay)
  const viewport = imageViewport(bounds, size)
  const placed = project.openings.flatMap((opening) => {
    const wall = openingWall(project.rooms, opening)
    return wall ? [{ opening, wall }] : []
  })
  const dimensions = wallLabels(
    project.rooms,
    project.furniture,
    project.openings,
    viewport,
    units,
    size,
  )
  const names = furnitureNames(
    project.rooms,
    project.furniture,
    viewport,
    units,
  )

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="font-mono"
      width={size.width}
      height={size.height}
      viewBox={`0 0 ${size.width} ${size.height}`}
    >
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
            scale={viewport.scale}
          />
        ))}
        {placed.map(({ opening, wall }) => (
          <OpeningShape key={opening.id} opening={opening} wall={wall} />
        ))}
      </g>

      <RoomLabels rooms={project.rooms} viewport={viewport} units={units} />
      <FurnitureLabels labels={names} />
      <WallDimensions labels={dimensions} />
    </svg>
  )
}

/**
 * Copy the styles the document computed onto a detached clone. Serialized SVG
 * leaves its stylesheet behind, so every painted property has to travel as an
 * attribute or the export comes out unstyled.
 */
export function inlineSvgStyles(
  source: SVGSVGElement,
  clone: SVGSVGElement,
): void {
  const sourceElements = [source, ...source.querySelectorAll('*')]
  const cloneElements = [clone, ...clone.querySelectorAll('*')]

  sourceElements.forEach((element, index) => {
    const target = cloneElements[index]
    if (!(target instanceof SVGElement)) return
    const computed = getComputedStyle(element)
    for (const property of SVG_STYLE_PROPERTIES) {
      target.style.setProperty(property, computed.getPropertyValue(property))
    }
  })
}

function contentBox(svg: SVGSVGElement): Rect {
  const fallback = {
    x: 0,
    y: 0,
    w: svg.width.baseVal.value,
    h: svg.height.baseVal.value,
  }
  const box = svg.getBBox()
  if (box.width === 0 || box.height === 0) return fallback
  return { x: box.x, y: box.y, w: box.width, h: box.height }
}

async function imageFrom(url: string): Promise<HTMLImageElement> {
  return await new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not render the plan image.'))
    image.src = url
  })
}

async function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Could not encode the plan image.'))
    }, 'image/png')
  })
}

export function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Could not read the underlay image.'))
    reader.onerror = () =>
      reject(reader.error ?? new Error('Could not read the underlay image.'))
    reader.readAsDataURL(blob)
  })
}

async function svgPng(svg: SVGSVGElement): Promise<Blob> {
  await document.fonts.ready

  const box = contentBox(svg)
  const crop = {
    x: box.x - CROP_PADDING,
    y: box.y - CROP_PADDING,
    w: box.w + CROP_PADDING * 2,
    h: box.h + CROP_PADDING * 2,
  }
  const scale = Math.min(1, MAX_RASTER_EDGE / Math.max(crop.w, crop.h))
  const width = Math.max(1, Math.round(crop.w * scale))
  const height = Math.max(1, Math.round(crop.h * scale))

  const clone = svg.cloneNode(true) as SVGSVGElement
  inlineSvgStyles(svg, clone)
  clone.setAttribute('width', String(crop.w))
  clone.setAttribute('height', String(crop.h))
  clone.setAttribute('viewBox', `${crop.x} ${crop.y} ${crop.w} ${crop.h}`)

  const background = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'rect',
  )
  background.setAttribute('x', String(crop.x))
  background.setAttribute('y', String(crop.y))
  background.setAttribute('width', String(crop.w))
  background.setAttribute('height', String(crop.h))
  background.setAttribute('fill', '#fff')
  clone.insertBefore(background, clone.firstChild)

  const markup = new XMLSerializer().serializeToString(clone)
  const url = URL.createObjectURL(
    new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }),
  )

  try {
    const image = await imageFrom(url)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not prepare the plan image.')
    context.drawImage(image, 0, 0, width, height)
    return await canvasPng(canvas)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Render a clean plan outside the editor and save it as a PNG image. */
export async function downloadProjectPng(
  project: Project,
  units: Units,
  underlay?: Underlay,
): Promise<void> {
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
        <PlanImage
          project={project}
          units={units}
          underlay={underlay}
          underlayHref={underlayHref}
        />,
      ),
    )
    const svg = host.querySelector('svg')
    if (!svg) throw new Error('Could not prepare the plan image.')
    const png = await svgPng(svg)
    downloadFile(
      png,
      projectFileName(
        underlay
          ? { ...project, name: `${project.name} with underlay` }
          : project,
        'png',
      ),
    )
  } finally {
    root.unmount()
    host.remove()
  }
}
