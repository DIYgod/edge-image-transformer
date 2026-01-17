import decodeJpeg from '@jsquash/jpeg/decode'
import decodePng from '@jsquash/png/decode'
import decodeWebp from '@jsquash/webp/decode'
import decodeAvif from '@jsquash/avif/decode'

import type { ImageFormat } from './detect-format'

export const decodeImage = async (data: ArrayBuffer, format: ImageFormat): Promise<ImageData> => {
  switch (format) {
    case 'jpeg':
      return decodeJpeg(data)
    case 'png':
      return decodePng(data)
    case 'webp':
      return decodeWebp(data)
    case 'avif':
      return decodeAvif(data)
    default:
      throw new Error(`Unsupported image format: ${format}`)
  }
}
