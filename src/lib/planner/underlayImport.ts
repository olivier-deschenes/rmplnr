import type { PDFDocumentProxy } from 'pdfjs-dist'

export type PreparedUnderlayAsset = {
  name: string
  source: 'image' | 'pdf'
  page: number | null
  mimeType: string
  blob: Blob
  pixelWidth: number
  pixelHeight: number
}

export type LoadedUnderlayPdf = {
  name: string
  pageCount: number
  renderPage: (page: number) => Promise<PreparedUnderlayAsset>
  destroy: () => Promise<void>
}

const PDF_RENDER_EDGE = 3000
let workerConfigured = false

function imageElement(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('This image could not be decoded by the browser.'))
    }
    image.src = url
  })
}

/** Validate a browser image and read its intrinsic pixel dimensions. */
export async function prepareImageFile(
  file: File,
): Promise<PreparedUnderlayAsset> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Choose an image or PDF file.')
  }

  const image = await imageElement(file)
  if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
    throw new Error('This image has no usable dimensions.')
  }

  return {
    name: file.name,
    source: 'image',
    page: null,
    mimeType: file.type,
    blob: file,
    pixelWidth: image.naturalWidth,
    pixelHeight: image.naturalHeight,
  }
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('The PDF page could not be turned into an image.'))
    }, 'image/png')
  })
}

async function renderPdfPage(
  document: PDFDocumentProxy,
  fileName: string,
  pageNumber: number,
): Promise<PreparedUnderlayAsset> {
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    throw new Error('Choose a valid PDF page.')
  }

  const page = await document.getPage(pageNumber)
  try {
    const original = page.getViewport({ scale: 1 })
    const scale = Math.min(
      3,
      PDF_RENDER_EDGE / Math.max(original.width, original.height),
    )
    const viewport = page.getViewport({ scale })
    const canvas = documentOwner().createElement('canvas')
    canvas.width = Math.max(1, Math.ceil(viewport.width))
    canvas.height = Math.max(1, Math.ceil(viewport.height))

    await page.render({ canvas, viewport }).promise
    const blob = await canvasBlob(canvas)
    return {
      name: `${fileName} · page ${pageNumber}`,
      source: 'pdf',
      page: pageNumber,
      mimeType: 'image/png',
      blob,
      pixelWidth: canvas.width,
      pixelHeight: canvas.height,
    }
  } finally {
    page.cleanup()
  }
}

function documentOwner(): Document {
  if (typeof document === 'undefined') {
    throw new Error('PDF pages can only be rendered in a browser.')
  }
  return document
}

/**
 * Open one PDF once, then render whichever page the import dialog asks for.
 * PDF.js stays in a lazy chunk and its matching worker is served by Vite.
 */
export async function loadUnderlayPdf(file: File): Promise<LoadedUnderlayPdf> {
  if (
    file.type !== 'application/pdf' &&
    !file.name.toLowerCase().endsWith('.pdf')
  ) {
    throw new Error('Choose an image or PDF file.')
  }

  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ])
  if (!workerConfigured) {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
    workerConfigured = true
  }

  const loading = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  })
  const pdf = await loading.promise

  return {
    name: file.name,
    pageCount: pdf.numPages,
    renderPage(page) {
      if (page > pdf.numPages) throw new Error('That PDF page does not exist.')
      return renderPdfPage(pdf, file.name, page)
    },
    destroy: () => loading.destroy(),
  }
}
