import { parseProjectFile, toProjectRecord } from './planSerialization.ts'

import type { Project } from './types.ts'

const COMPRESSED_SHARE_FORMAT = 'z1'
const PLAIN_SHARE_FORMAT = 'j1'

/** A share link can be opened without sending its plan contents to the server. */
export class SharedPlanError extends Error {
  constructor() {
    super('This share link is incomplete or damaged.')
    this.name = 'SharedPlanError'
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 32_768
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
}

function fromBase64Url(value: string): Uint8Array {
  if (!value || !/^[A-Za-z0-9_-]+$/u.test(value)) throw new SharedPlanError()
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
}

async function compress(value: string): Promise<Uint8Array> {
  const stream = new Blob([value])
    .stream()
    .pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function decompress(value: Uint8Array): Promise<string> {
  const stream = new Blob([new Uint8Array(value)])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

/** The complete, strict plan record, compressed for a practical URL. */
export async function encodeSharedProject(project: Project): Promise<string> {
  const json = JSON.stringify(toProjectRecord(project))
  const bytes = new TextEncoder().encode(json)
  if (typeof CompressionStream === 'undefined') {
    return `${PLAIN_SHARE_FORMAT}.${toBase64Url(bytes)}`
  }
  return `${COMPRESSED_SHARE_FORMAT}.${toBase64Url(await compress(json))}`
}

/** Read and validate a plan carried by a share URL. */
export async function decodeSharedProject(value: string): Promise<Project> {
  try {
    const [format, contents, extra] = value.split('.')
    if (!contents || extra) throw new SharedPlanError()
    const bytes = fromBase64Url(contents)
    const json =
      format === COMPRESSED_SHARE_FORMAT
        ? await decompress(bytes)
        : format === PLAIN_SHARE_FORMAT
          ? new TextDecoder().decode(bytes)
          : null
    if (json === null) throw new SharedPlanError()
    return parseProjectFile(json)
  } catch {
    throw new SharedPlanError()
  }
}

/** Build a self-contained link whose fragment stays out of server requests. */
export async function projectShareUrl(
  project: Project,
  baseUrl = window.location.href,
): Promise<string> {
  const url = new URL('/share', baseUrl)
  url.hash = await encodeSharedProject(project)
  return url.toString()
}
