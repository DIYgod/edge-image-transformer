import { Hono } from 'hono'

import { ensureCodecsInitialised } from './lib/codec-init'
import { detectImageFormat, formatToContentType } from './lib/detect-format'
import type { ImageFormat } from './lib/detect-format'
import { resolveDimensions } from './lib/dimensions'
import { FetchImageError, fetchRemoteImageThroughProxy } from './lib/image-proxy-client'
import { decodeImage, encodeImage, resizeImage } from './lib/image-processor'

type Bindings = {
  IMAGE_PROXY: Fetcher
}

const app = new Hono<{ Bindings: Bindings }>()

const parseDimensionParam = (value: string | undefined | null): number | undefined => {
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined
  }
  return parsed
}

const detectSupportedFormat = (
  buffer: ArrayBuffer,
  contentType: string | null
): ImageFormat | null => {
  return detectImageFormat(new Uint8Array(buffer), contentType)
}

const parseTargetFormatParam = (value: string | undefined | null): ImageFormat | null => {
  if (!value) {
    return null
  }
  const normalised = value.trim().toLowerCase()
  switch (normalised) {
    case 'jpeg':
    case 'jpg':
      return 'jpeg'
    case 'png':
      return 'png'
    case 'webp':
      return 'webp'
    case 'avif':
      return 'avif'
    default:
      return null
  }
}

app.get('/', async (c) => {
  const url = c.req.query('url')
  if (!url) {
    return c.json({ error: 'Missing url parameter' }, 400)
  }

  const rawWidth = c.req.query('width')
  const rawHeight = c.req.query('height')
  const widthParam = parseDimensionParam(rawWidth)
  const heightParam = parseDimensionParam(rawHeight)

  if (rawWidth && widthParam === undefined) {
    return c.json({ error: 'Invalid width parameter' }, 400)
  }

  if (rawHeight && heightParam === undefined) {
    return c.json({ error: 'Invalid height parameter' }, 400)
  }

  const formatParam = c.req.query('format')
  const requestedTargetFormat = parseTargetFormatParam(formatParam)
  if (formatParam && !requestedTargetFormat) {
    return c.json({ error: 'Unsupported output format requested' }, 400)
  }

  let remote
  try {
    remote = await fetchRemoteImageThroughProxy(url, c.env.IMAGE_PROXY)
  } catch (error) {
    if (error instanceof FetchImageError) {
      return c.json({ error: error.message }, error.status ?? 502)
    }
    console.error(error)
    return c.json({ error: 'Unexpected error fetching image' }, 502)
  }

  const sourceFormat = detectSupportedFormat(remote.buffer, remote.contentType)

  if (!sourceFormat) {
    const headers = new Headers({
      'Cache-Control': 'public, max-age=31536000'
    })
    headers.set('Content-Type', remote.contentType ?? 'application/octet-stream')
    headers.set('Content-Length', remote.buffer.byteLength.toString())
    return new Response(remote.buffer, { status: 200, headers })
  }

  const shouldReturnOriginal =
    widthParam === undefined &&
    heightParam === undefined &&
    (!requestedTargetFormat || requestedTargetFormat === sourceFormat)

  if (shouldReturnOriginal) {
    const headers = new Headers({
      'Content-Type': remote.contentType ?? formatToContentType(sourceFormat),
      'Cache-Control': 'public, max-age=31536000'
    })
    headers.set('Content-Length', remote.buffer.byteLength.toString())
    return new Response(remote.buffer, { status: 200, headers })
  }

  try {
    await ensureCodecsInitialised()
  } catch (error) {
    console.error('Failed to initialise codecs', error)
    return c.json({ error: 'Failed to prepare image codecs' }, 500)
  }

  let decoded: ImageData
  try {
    decoded = await decodeImage(remote.buffer, sourceFormat)
  } catch (error) {
    console.error('Failed to decode image', error)
    return c.json({ error: 'Failed to decode source image' }, 422)
  }

  const needsResize = widthParam !== undefined || heightParam !== undefined

  let targetWidth = decoded.width
  let targetHeight = decoded.height
  if (needsResize) {
    try {
      const target = resolveDimensions(
        { width: decoded.width, height: decoded.height },
        { width: widthParam, height: heightParam }
      )
      targetWidth = target.width
      targetHeight = target.height
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Invalid resize parameters' }, 400)
    }
  }

  let resized = decoded
  if (needsResize) {
    try {
      resized = await resizeImage(decoded, targetWidth, targetHeight)
    } catch (error: any) {
      console.error('Failed to resize image', error.stack)
      return c.json({ error: 'Unable to resize image with the given parameters' }, 422)
    }
  }
  const targetFormat: ImageFormat = requestedTargetFormat ?? sourceFormat

  let encoded: ArrayBuffer
  try {
    encoded = await encodeImage(resized, targetFormat)
  } catch (error) {
    console.error('Failed to encode image', error)
    return c.json({ error: 'Failed to encode resized image' }, 500)
  }

  const headers = new Headers({
    'Content-Type': formatToContentType(targetFormat),
    'Cache-Control': 'public, max-age=31536000'
  })
  headers.set('Content-Length', encoded.byteLength.toString())

  return new Response(encoded, { status: 200, headers })
})

app.get('/meta/', async (c) => {
  const url = c.req.query('url')
  if (!url) {
    return c.json({ error: 'Missing url parameter' }, 400)
  }

  let remote
  try {
    remote = await fetchRemoteImageThroughProxy(url, c.env.IMAGE_PROXY)
  } catch (error) {
    if (error instanceof FetchImageError) {
      return c.json({ error: error.message }, error.status ?? 502)
    }
    console.error(error)
    return c.json({ error: 'Unexpected error fetching image' }, 502)
  }

  try {
    await ensureCodecsInitialised()
  } catch (error) {
    console.error('Failed to initialise codecs', error)
    return c.json({ error: 'Failed to prepare image codecs' }, 500)
  }

  const format = detectSupportedFormat(remote.buffer, remote.contentType)
  if (!format) {
    return c.json({ error: 'Unsupported image format' }, 415)
  }

  let decoded: ImageData
  try {
    decoded = await decodeImage(remote.buffer, format)
  } catch (error) {
    console.error('Failed to decode image', error)
    return c.json({ error: 'Failed to decode source image' }, 422)
  }

  c.header('Cache-Control', 'public, max-age=31536000')
  return c.json({
    width: decoded.width,
    height: decoded.height
  })
})

export default app
