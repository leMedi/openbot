export type ImageDimensions = { width: number; height: number }

/** Returns dimensions only for a structurally valid RIFF WebP payload. */
export function webPDimensions(bytes: Buffer): ImageDimensions | undefined {
  if (
    bytes.length < 20 ||
    bytes.subarray(0, 4).toString('ascii') !== 'RIFF' ||
    bytes.readUInt32LE(4) + 8 !== bytes.length ||
    bytes.subarray(8, 12).toString('ascii') !== 'WEBP'
  ) {
    return undefined
  }
  let dimensions: ImageDimensions | undefined
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const type = bytes.subarray(offset, offset + 4).toString('ascii')
    const size = bytes.readUInt32LE(offset + 4)
    const data = offset + 8
    if (data + size > bytes.length) return undefined
    if (type === 'VP8X' && size >= 10) {
      dimensions = {
        width: 1 + bytes.readUIntLE(data + 4, 3),
        height: 1 + bytes.readUIntLE(data + 7, 3),
      }
    } else if (
      type === 'VP8 ' &&
      size >= 10 &&
      bytes.subarray(data + 3, data + 6).equals(Buffer.from([0x9d, 0x01, 0x2a]))
    ) {
      dimensions = {
        width: bytes.readUInt16LE(data + 6) & 0x3fff,
        height: bytes.readUInt16LE(data + 8) & 0x3fff,
      }
    } else if (type === 'VP8L' && size >= 5 && bytes[data] === 0x2f) {
      const bits = bytes.readUInt32LE(data + 1)
      dimensions = {
        width: 1 + (bits & 0x3fff),
        height: 1 + ((bits >> 14) & 0x3fff),
      }
    }
    offset = data + size + (size % 2)
  }
  return offset === bytes.length ? dimensions : undefined
}
