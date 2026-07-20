import { describe, expect, it } from 'vitest'
import { readFile, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BODY_CATALOG } from '../domain/bodies'
import { spawn } from 'node:child_process'
import { calculateAxialRotationRadians, createDiagnosticsPublicationGate } from './SolarScene'
import { MAX_ANISOTROPY, MAX_DPR, QUALITY_TIERS, TEXTURE_CATALOG } from './textureCatalog'

const textureRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/textures')

function decodeRgba(path: string): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const decoder = spawn('ffmpeg', ['-loglevel', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'])
    const chunks: Buffer[] = []
    decoder.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    decoder.stderr.on('data', () => undefined)
    decoder.on('error', reject)
    decoder.on('close', (code) => {
      if (code === 0) resolvePromise(Buffer.concat(chunks))
      else reject(new Error(`ffmpeg exited with code ${code}`))
    })
  })
}

function parseWebpChunks(asset: Buffer): Array<{ type: string; payload: Buffer }> {
  const chunks: Array<{ type: string; payload: Buffer }> = []
  const riffEnd = Math.min(asset.length, asset.readUInt32LE(4) + 8)

  for (let offset = 12; offset + 8 <= riffEnd;) {
    const type = asset.subarray(offset, offset + 4).toString('ascii')
    const size = asset.readUInt32LE(offset + 4)
    const payloadEnd = offset + 8 + size
    if (payloadEnd > riffEnd) break
    chunks.push({ type, payload: asset.subarray(offset + 8, payloadEnd) })
    offset = payloadEnd + (size % 2)
  }

  return chunks
}

describe('rendering asset catalog', () => {
  it('covers the Sun, eight planets, and Saturn rings with local maps', () => {
    expect(TEXTURE_CATALOG.map((entry) => entry.key)).toEqual([
      'sun', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'saturn-rings'
    ])
    expect(TEXTURE_CATALOG.slice(0, 9).map((entry) => entry.body)).toEqual(BODY_CATALOG.map((body) => body.id))
    expect(TEXTURE_CATALOG.every((entry) => entry.path.startsWith('/textures/'))).toBe(true)
  })

  it('records 2K source and encoded width for every map', () => {
    expect(TEXTURE_CATALOG.every((entry) => entry.sourceDimensions[0] >= 2048 && entry.encodedDimensions[0] >= 2048)).toBe(true)
    expect(TEXTURE_CATALOG.every((entry) => entry.bytes > 0)).toBe(true)
  })

  it('uses explicit sRGB intent and a dedicated ring assignment', () => {
    expect(TEXTURE_CATALOG.every((entry) => entry.colorSpace === 'srgb' || entry.colorSpace === 'srgb-alpha')).toBe(true)
    expect(TEXTURE_CATALOG.find((entry) => entry.key === 'saturn-rings')?.body).toBe('saturn')
    expect(TEXTURE_CATALOG.find((entry) => entry.key === 'saturn-rings')?.colorSpace).toBe('srgb-alpha')
  })

  it('calculates Sun axial rotation independently of frame cadence', () => {
    const axialRotationHours = BODY_CATALOG[0].axialRotationHours
    const rotationAtSixtyFrames = Array.from({ length: 60 }, () => calculateAxialRotationRadians(1 / 60, axialRotationHours)).reduce((total, step) => total + step, 0)
    const rotationAtThirtyFrames = Array.from({ length: 30 }, () => calculateAxialRotationRadians(1 / 30, axialRotationHours)).reduce((total, step) => total + step, 0)

    expect(rotationAtSixtyFrames).toBeCloseTo(rotationAtThirtyFrames, 12)
    expect(rotationAtSixtyFrames).toBeGreaterThan(0)
  })

  it('verifies physical WebP payloads and manifest byte metadata', async () => {
    const manifest = JSON.parse(await readFile(resolve(textureRoot, 'manifest.json'), 'utf8')) as {
      textures: Array<{ key: string; bytes: number; encodedDimensions: [number, number]; colorSpace: string; format: string }>
    }
    const manifestByKey = new Map(manifest.textures.map((entry) => [entry.key, entry]))

    for (const entry of TEXTURE_CATALOG) {
      const asset = await readFile(resolve(textureRoot, `${entry.key}.webp`))
      const physicalSize = (await stat(resolve(textureRoot, `${entry.key}.webp`))).size
      const manifestEntry = manifestByKey.get(entry.key)

      expect(asset.subarray(0, 4).toString('ascii')).toBe('RIFF')
      expect(asset.subarray(8, 12).toString('ascii')).toBe('WEBP')
      const iccProfile = parseWebpChunks(asset).find((chunk) => chunk.type === 'ICCP')
      expect(iccProfile).toBeDefined()
      expect(iccProfile?.payload.toString('ascii')).toContain('sRGB')
      expect(entry.format).toBe('webp')
      expect(manifestEntry?.format).toBe('webp')
      expect(entry.bytes).toBe(physicalSize)
      expect(manifestEntry?.bytes).toBe(physicalSize)
      expect(manifestEntry?.encodedDimensions).toEqual(entry.encodedDimensions)
      expect(manifestEntry?.colorSpace).toBe(entry.colorSpace)
    }

    const ring = TEXTURE_CATALOG.find((entry) => entry.key === 'saturn-rings')
    expect(ring?.encodedDimensions).toEqual([2048, 512])
    expect(ring?.colorSpace).toBe('srgb-alpha')
    expect(TEXTURE_CATALOG.filter((entry) => entry.key !== 'saturn-rings').every((entry) => entry.encodedDimensions[0] === 2048 && entry.encodedDimensions[1] === 1024 && entry.colorSpace === 'srgb')).toBe(true)

    const ringPixels = await decodeRgba(resolve(textureRoot, 'saturn-rings.webp'))
    const alphaValues = new Set<number>()
    let nonzeroAlphaPixels = 0
    let minimumAlpha = 255
    let maximumAlpha = 0
    for (let index = 3; index < ringPixels.length; index += 4) {
      const alpha = ringPixels[index]
      alphaValues.add(alpha)
      minimumAlpha = Math.min(minimumAlpha, alpha)
      maximumAlpha = Math.max(maximumAlpha, alpha)
      if (alpha > 0) nonzeroAlphaPixels += 1
    }

    const pixelCount = ringPixels.length / 4
    expect(pixelCount).toBe(2048 * 512)
    expect(nonzeroAlphaPixels).toBeGreaterThan(pixelCount * 0.05)
    expect(alphaValues.size).toBeGreaterThan(4)
    expect(maximumAlpha - minimumAlpha).toBeGreaterThan(32)
  })

  it('keeps renderer quality within bounded browser-safe limits', () => {
    expect(MAX_DPR).toBeLessThanOrEqual(2)
    expect(MAX_ANISOTROPY).toBeLessThanOrEqual(4)
    expect(Object.keys(QUALITY_TIERS)).toEqual(['eco', 'balanced', 'cinematic'])
    expect(Object.values(QUALITY_TIERS).every((value) => value > 0 && value <= 1.25)).toBe(true)
  })

  it('publishes diagnostics initially and no more than four times per second', () => {
    const gate = createDiagnosticsPublicationGate()
    let publications = 0

    for (let frame = 0; frame < 60; frame += 1) {
      if (gate(frame / 60)) publications += 1
    }

    expect(publications).toBeGreaterThan(0)
    expect(publications).toBeLessThanOrEqual(4)
    expect(createDiagnosticsPublicationGate()(0)).toBe(true)
  })
})
