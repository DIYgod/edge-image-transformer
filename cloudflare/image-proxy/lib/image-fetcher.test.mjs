import assert from 'node:assert/strict'
import { test } from 'node:test'

import { fetchRemoteImage } from './image-fetcher.ts'

test('fetchRemoteImage requests i.pximg.net when source host is i.pixiv.re', async () => {
  const originalFetch = globalThis.fetch
  let requestedUrl
  let requestedHeaders

  globalThis.fetch = async (input, init) => {
    requestedUrl = input instanceof Request ? input.url : String(input)
    requestedHeaders = new Headers(init?.headers)
    return new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: {
        'Content-Type': 'image/png'
      }
    })
  }

  try {
    await fetchRemoteImage('https://i.pixiv.re/img-original/img/2026/01/02/03/04/05/123456789_p0.png?token=abc')
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(
    requestedUrl,
    'https://i.pximg.net/img-original/img/2026/01/02/03/04/05/123456789_p0.png?token=abc'
  )
  assert.equal(requestedHeaders.get('Referer'), 'https://www.pixiv.net')
  assert.equal(requestedHeaders.get('Origin'), 'https://www.pixiv.net')
})
