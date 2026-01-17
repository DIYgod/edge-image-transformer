export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'avif'

const MIME_TO_FORMAT: Record<string, ImageFormat> = {
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif'
}

export const detectImageFormat = (buffer: Uint8Array, contentType?: string | null): ImageFormat | null => {
  if (contentType) {
    const normalised = contentType.split(';')[0]?.trim().toLowerCase()
    if (normalised && normalised in MIME_TO_FORMAT) {
      return MIME_TO_FORMAT[normalised]
    }
  }

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg'
  }

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png'
  }

  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 && // R
    buffer[1] === 0x49 && // I
    buffer[2] === 0x46 && // F
    buffer[3] === 0x46 && // F
    buffer[8] === 0x57 && // W
    buffer[9] === 0x45 && // E
    buffer[10] === 0x42 && // B
    buffer[11] === 0x50 // P
  ) {
    return 'webp'
  }

  if (
    buffer.length >= 12 &&
    buffer[4] === 0x66 && // f
    buffer[5] === 0x74 && // t
    buffer[6] === 0x79 && // y
    buffer[7] === 0x70 // p
  ) {
    const majorBrand = String.fromCharCode(buffer[8], buffer[9], buffer[10], buffer[11])
    if (majorBrand === 'avif' || majorBrand === 'avis' || majorBrand === 'av01') {
      return 'avif'
    }
  }

  return null
}
