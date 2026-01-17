import { init as initJpegDecode } from '@jsquash/jpeg/decode'
import { init as initPngDecode } from '@jsquash/png/decode'
import { init as initWebpDecode } from '@jsquash/webp/decode'
import { init as initAvifDecode } from '@jsquash/avif/decode'

import JPEG_DEC_WASM from '@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm'
import PNG_WASM from '@jsquash/png/codec/pkg/squoosh_png_bg.wasm'
import WEBP_DEC_WASM from '@jsquash/webp/codec/dec/webp_dec.wasm'
import AVIF_DEC_WASM from '@jsquash/avif/codec/dec/avif_dec.wasm'

let initPromise: Promise<void> | null = null

async function initialiseCodecs() {
  await Promise.all([
    initJpegDecode(JPEG_DEC_WASM),
    initPngDecode(PNG_WASM),
    initWebpDecode(WEBP_DEC_WASM),
    initAvifDecode(AVIF_DEC_WASM)
  ])
}

export const ensureCodecsInitialised = () => {
  if (!initPromise) {
    initPromise = initialiseCodecs()
  }
  return initPromise
}
