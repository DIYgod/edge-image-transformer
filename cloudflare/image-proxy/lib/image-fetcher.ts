const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

type ImageRefererMatch = {
  url: RegExp
  referer: string
  force?: boolean
}

// Host-specific referer/origin overrides for providers that block direct hotlinks.
export const imageRefererMatches: ImageRefererMatch[] = [
  {
    url: /^https:\/\/\w+\.sinaimg\.cn/,
    referer: 'https://weibo.com'
  },
  {
    url: /^https:\/\/i\.pximg\.net/,
    referer: 'https://www.pixiv.net'
  },
  {
    url: /^https:\/\/cdnfile\.sspai\.com/,
    referer: 'https://sspai.com'
  },
  {
    url: /^https:\/\/(?:\w|-)+\.cdninstagram\.com/,
    referer: 'https://www.instagram.com'
  },
  {
    url: /^https:\/\/sp1\.piokok\.com/,
    referer: 'https://www.piokok.com',
    force: true
  },
  {
    url: /^https?:\/\/[\w-]+\.xhscdn\.com/,
    referer: 'https://www.xiaohongshu.com'
  }
]

export const normalizeImageUrl = (parsed: URL): URL => {
  if (parsed.hostname !== 'i.pixiv.re') {
    return parsed
  }

  const normalized = new URL(parsed.toString())
  normalized.hostname = 'i.pximg.net'
  return normalized
}

export class FetchImageError extends Error {
  status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'FetchImageError'
    this.status = status
  }
}

const resolveRefererFor = (parsed: URL): { referer: string; origin: string } => {
  const origin = parsed.origin
  const matchedReferer = imageRefererMatches.find(({ url }) => url.test(parsed.href))
  const referer = matchedReferer?.referer ?? origin

  if (!matchedReferer) {
    return { referer, origin }
  }

  try {
    const refererUrl = new URL(referer)
    return { referer, origin: refererUrl.origin }
  } catch {
    return { referer, origin: referer }
  }
}

const CACHE_TTL_SECONDS = 60 * 60 * 24 * 365
const CACHE_TTL_BY_STATUS: Record<string, number> = {
  '200-299': CACHE_TTL_SECONDS,
  '301-308': CACHE_TTL_SECONDS,
  '400-599': 0
}

const buildUpstreamHeaders = (parsed: URL): Headers => {
  const { referer, origin } = resolveRefererFor(parsed)
  const headers = new Headers({
    'User-Agent': DEFAULT_UA,
    Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    Referer: referer,
    Origin: origin
  })
  return headers
}

export const fetchRemoteImage = async (imageUrl: string): Promise<Response> => {
  let parsed: URL
  try {
    parsed = new URL(imageUrl)
  } catch {
    throw new FetchImageError('Invalid image url')
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new FetchImageError('Only http and https protocols are supported')
  }
  parsed = normalizeImageUrl(parsed)

  const headers = buildUpstreamHeaders(parsed)
  const response = await fetch(parsed.toString(), {
    headers,
    redirect: 'follow',
    cf: {
      cacheEverything: true,
      cacheTtlByStatus: CACHE_TTL_BY_STATUS
    }
  })

  if (!response.ok) {
    throw new FetchImageError(`Failed to fetch image: ${response.statusText}`, response.status)
  }

  return response
}
