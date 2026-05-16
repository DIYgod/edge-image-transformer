import assert from 'node:assert/strict'
import { test } from 'node:test'

import * as fetcher from './image-fetcher.ts'

test('normalizes i.pixiv.re image URLs to i.pximg.net', () => {
  assert.equal(typeof fetcher.normalizeImageUrl, 'function')

  const normalized = fetcher.normalizeImageUrl(
    new URL('https://i.pixiv.re/img-original/img/2026/01/02/03/04/05/123456789_p0.png?token=abc')
  )

  assert.equal(
    normalized.toString(),
    'https://i.pximg.net/img-original/img/2026/01/02/03/04/05/123456789_p0.png?token=abc'
  )
})

test('keeps Pixiv upstream headers after normalizing i.pixiv.re URLs', () => {
  assert.equal(typeof fetcher.normalizeImageUrl, 'function')

  const normalized = fetcher.normalizeImageUrl(
    new URL('https://i.pixiv.re/img-original/img/2026/01/02/03/04/05/123456789_p0.png')
  )
  const headers = fetcher.buildUpstreamHeaders(normalized)

  assert.equal(headers.get('Referer'), 'https://www.pixiv.net')
  assert.equal(headers.get('Origin'), 'https://www.pixiv.net')
})
