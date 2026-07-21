import { inflateSync } from 'node:zlib'

export interface PixelFrame {
  readonly width: number
  readonly height: number
  readonly rgba: Uint8Array
}

export interface PixelRegion {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface PixelMetrics {
  readonly nonBackgroundCoverage: number
  readonly channelVariance: number
  readonly meanLuminance: number
  readonly sampledPixels: number
  readonly nonBlankPixels: number
  readonly uniqueColors: number
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset)
}

function chunkType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])
}

function undoFilters(data: Uint8Array, width: number, height: number, bytesPerPixel: number): Uint8Array {
  const rowLength = width * bytesPerPixel
  const result = new Uint8Array(height * rowLength)
  let sourceOffset = 0

  for (let row = 0; row < height; row += 1) {
    const filter = data[sourceOffset]
    sourceOffset += 1
    const rowOffset = row * rowLength
    const priorOffset = rowOffset - rowLength
    for (let column = 0; column < rowLength; column += 1) {
      const raw = data[sourceOffset + column]
      const left = column >= bytesPerPixel ? result[rowOffset + column - bytesPerPixel] : 0
      const above = row > 0 ? result[priorOffset + column] : 0
      const upperLeft = row > 0 && column >= bytesPerPixel ? result[priorOffset + column - bytesPerPixel] : 0
      let value = raw
      if (filter === 1) value = raw + left
      else if (filter === 2) value = raw + above
      else if (filter === 3) value = raw + Math.floor((left + above) / 2)
      else if (filter === 4) {
        const predictor = left + above - upperLeft
        const pa = Math.abs(predictor - left)
        const pb = Math.abs(predictor - above)
        const pc = Math.abs(predictor - upperLeft)
        value = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? above : upperLeft)
      }
      result[rowOffset + column] = value & 0xff
    }
    sourceOffset += rowLength
  }
  return result
}

export function decodePng(buffer: Uint8Array): PixelFrame {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (!signature.every((value, index) => buffer[index] === value)) throw new Error('Expected a PNG screenshot')

  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idat: Uint8Array[] = []
  let offset = 8
  while (offset < buffer.length) {
    const length = readUint32(buffer, offset)
    const type = chunkType(buffer, offset + 4)
    const content = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = readUint32(content, 0)
      height = readUint32(content, 4)
      bitDepth = content[8]
      colorType = content[9]
    } else if (type === 'IDAT') idat.push(content)
    else if (type === 'IEND') break
    offset += length + 12
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) throw new Error('Unsupported screenshot PNG format')

  const bytesPerPixel = colorType === 6 ? 4 : 3
  const compressed = new Uint8Array(idat.reduce((total, part) => total + part.length, 0))
  let compressedOffset = 0
  for (const part of idat) {
    compressed.set(part, compressedOffset)
    compressedOffset += part.length
  }
  const filtered = undoFilters(inflateSync(compressed), width, height, bytesPerPixel)
  const rgba = new Uint8Array(width * height * 4)
  for (let index = 0; index < width * height; index += 1) {
    const source = index * bytesPerPixel
    const target = index * 4
    rgba[target] = filtered[source]
    rgba[target + 1] = filtered[source + 1]
    rgba[target + 2] = filtered[source + 2]
    rgba[target + 3] = colorType === 6 ? filtered[source + 3] : 255
  }
  return { width, height, rgba }
}

function eachSample(frame: PixelFrame, region: PixelRegion | undefined, callback: (index: number) => void): void {
  const x0 = Math.max(0, Math.floor(region?.x ?? 0))
  const y0 = Math.max(0, Math.floor(region?.y ?? 0))
  const x1 = Math.min(frame.width, Math.ceil((region?.x ?? 0) + (region?.width ?? frame.width)))
  const y1 = Math.min(frame.height, Math.ceil((region?.y ?? 0) + (region?.height ?? frame.height)))
  for (let y = y0; y < y1; y += 3) for (let x = x0; x < x1; x += 3) callback((y * frame.width + x) * 4)
}

export function analyzePixels(frame: PixelFrame, region?: PixelRegion): PixelMetrics {
  const background = [frame.rgba[0], frame.rgba[1], frame.rgba[2]]
  let samples = 0
  let nonBackground = 0
  let luminanceTotal = 0
  let luminanceSquaredTotal = 0
  let redTotal = 0
  let greenTotal = 0
  let blueTotal = 0
  let redSquaredTotal = 0
  let greenSquaredTotal = 0
  let blueSquaredTotal = 0
  const colors = new Set<number>()
  eachSample(frame, region, (index) => {
    const red = frame.rgba[index]
    const green = frame.rgba[index + 1]
    const blue = frame.rgba[index + 2]
    const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722
    const distance = Math.hypot(red - background[0], green - background[1], blue - background[2])
    colors.add((red << 16) | (green << 8) | blue)
    samples += 1
    if (distance > 18) nonBackground += 1
    luminanceTotal += luminance
    luminanceSquaredTotal += luminance * luminance
    redTotal += red
    greenTotal += green
    blueTotal += blue
    redSquaredTotal += red * red
    greenSquaredTotal += green * green
    blueSquaredTotal += blue * blue
  })
  const meanLuminance = luminanceTotal / Math.max(1, samples)
  const sampleCount = Math.max(1, samples)
  const channelVariance = (
    (redSquaredTotal / sampleCount - (redTotal / sampleCount) ** 2) +
    (greenSquaredTotal / sampleCount - (greenTotal / sampleCount) ** 2) +
    (blueSquaredTotal / sampleCount - (blueTotal / sampleCount) ** 2)
  ) / 3
  return {
    nonBackgroundCoverage: nonBackground / sampleCount,
    channelVariance: Math.max(0, channelVariance, luminanceSquaredTotal / sampleCount - meanLuminance ** 2),
    meanLuminance,
    sampledPixels: samples,
    nonBlankPixels: nonBackground,
    uniqueColors: colors.size
  }
}

export function regionalChange(before: PixelFrame, after: PixelFrame, region?: PixelRegion): number {
  if (before.width !== after.width || before.height !== after.height) throw new Error('Pixel frames must have equal dimensions')
  let samples = 0
  let changed = 0
  eachSample(before, region, (index) => {
    const difference = Math.abs(before.rgba[index] - after.rgba[index]) + Math.abs(before.rgba[index + 1] - after.rgba[index + 1]) + Math.abs(before.rgba[index + 2] - after.rgba[index + 2])
    samples += 1
    if (difference > 30) changed += 1
  })
  return changed / Math.max(1, samples)
}

export function frameDifference(before: PixelFrame, after: PixelFrame): number {
  return regionalChange(before, after)
}
