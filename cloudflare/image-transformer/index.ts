import { Hono } from 'hono'

import { ensureCodecsInitialised } from './lib/codec-init'
import { detectImageFormat } from './lib/detect-format'
import { buildUpstreamHeaders } from './lib/image-fetcher'
import { decodeImage } from './lib/image-processor'

const app = new Hono()

const CACHE_TTL_SECONDS = 60 * 60 * 24 * 365

// Prevent infinite loop when Cloudflare image resizing calls back to worker
const isImageResizingRequest = (request: Request): boolean => {
  const via = request.headers.get('via')
  return via !== null && /image-resizing/.test(via)
}

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

type CfImageFormat = 'avif' | 'webp' | 'jpeg'

const parseTargetFormatParam = (value: string | undefined | null): CfImageFormat | null => {
  if (!value) {
    return null
  }
  const normalised = value.trim().toLowerCase()
  switch (normalised) {
    case 'jpeg':
    case 'jpg':
      return 'jpeg'
    case 'png':
      // PNG output not supported by CF Images, fallback to webp (preserves transparency)
      return 'webp'
    case 'webp':
      return 'webp'
    case 'avif':
      return 'avif'
    default:
      return null
  }
}

app.get('/', async (c) => {
  // Prevent infinite loop
  if (isImageResizingRequest(c.req.raw)) {
    return c.json({ error: 'Recursive image resizing detected' }, 400)
  }

  const url = c.req.query('url')
  if (!url) {
    return c.json({ error: 'Missing url parameter' }, 400)
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return c.json({ error: 'Invalid image url' }, 400)
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return c.json({ error: 'Only http and https protocols are supported' }, 400)
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

  // Build cf.image options
  const imageOptions: RequestInitCfPropertiesImage = {
    fit: 'cover'
  }

  if (widthParam !== undefined) {
    imageOptions.width = widthParam
  }
  if (heightParam !== undefined) {
    imageOptions.height = heightParam
  }
  if (requestedTargetFormat) {
    imageOptions.format = requestedTargetFormat
  }

  const headers = buildUpstreamHeaders(parsed)

  try {
    const response = await fetch(parsed.toString(), {
      headers,
      redirect: 'follow',
      cf: {
        image: imageOptions,
        cacheEverything: true,
        cacheTtl: CACHE_TTL_SECONDS
      }
    })

    if (!response.ok) {
      return c.json({ error: `Failed to fetch/transform image: ${response.statusText}` }, response.status >= 400 && response.status < 600 ? response.status : 502)
    }

    const responseHeaders = new Headers()
    const contentType = response.headers.get('content-type')
    if (contentType) {
      responseHeaders.set('Content-Type', contentType)
    }
    responseHeaders.set('Cache-Control', `public, max-age=${CACHE_TTL_SECONDS}`)

    return new Response(response.body, {
      status: 200,
      headers: responseHeaders
    })
  } catch (error) {
    console.error('Image transformation failed:', error)
    return c.json({ error: 'Failed to transform image' }, 502)
  }
})

app.get('/meta/', async (c) => {
  const url = c.req.query('url')
  if (!url) {
    return c.json({ error: 'Missing url parameter' }, 400)
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return c.json({ error: 'Invalid image url' }, 400)
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return c.json({ error: 'Only http and https protocols are supported' }, 400)
  }

  const headers = buildUpstreamHeaders(parsed)

  try {
    const response = await fetch(parsed.toString(), {
      headers,
      redirect: 'follow'
    })

    if (!response.ok) {
      return c.json({ error: `Failed to fetch image: ${response.statusText}` }, response.status >= 400 && response.status < 600 ? response.status : 502)
    }

    const buffer = await response.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    const contentType = response.headers.get('content-type')
    const format = detectImageFormat(bytes, contentType)

    if (!format) {
      return c.json({ error: 'Unsupported image format' }, 422)
    }

    await ensureCodecsInitialised()
    const decoded = await decodeImage(buffer, format)

    c.header('Cache-Control', `public, max-age=${CACHE_TTL_SECONDS}`)
    return c.json({
      width: decoded.width,
      height: decoded.height
    })
  } catch (error) {
    console.error('Failed to get image metadata:', error)
    return c.json({ error: 'Failed to get image metadata' }, 502)
  }
})

export default app
