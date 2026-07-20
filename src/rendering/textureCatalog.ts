import { TextureLoader, type Texture } from 'three'
import { SRGBColorSpace, LinearFilter, LinearMipmapLinearFilter } from 'three'
import type { BodyId } from '../domain/bodies'

export type TextureColorSpace = 'srgb' | 'srgb-alpha'

export interface TextureManifestEntry {
  readonly key: string
  readonly path: string
  readonly body: BodyId
  readonly sourceDimensions: readonly [number, number]
  readonly encodedDimensions: readonly [number, number]
  readonly colorSpace: TextureColorSpace
  readonly format: 'webp'
  readonly bytes: number
}

export const TEXTURE_MANIFEST_URL = '/textures/manifest.json'
export const MAX_DPR = 1.75
export const MAX_ANISOTROPY = 4
export const QUALITY_TIERS = Object.freeze({ eco: 0.7, balanced: 1, cinematic: 1.25 })
const TEXTURE_BYTES = {
  sun: 297552,
  mercury: 463056,
  venus: 399640,
  earth: 141744,
  mars: 328302,
  jupiter: 130626,
  saturn: 85602,
  uranus: 65618,
  neptune: 141046,
  'saturn-rings': 1109996
} as const

export const TEXTURE_CATALOG: readonly TextureManifestEntry[] = Object.freeze([
  ['sun', 'sun', 'srgb'],
  ['mercury', 'mercury', 'srgb'],
  ['venus', 'venus', 'srgb'],
  ['earth', 'earth', 'srgb'],
  ['mars', 'mars', 'srgb'],
  ['jupiter', 'jupiter', 'srgb'],
  ['saturn', 'saturn', 'srgb'],
  ['uranus', 'uranus', 'srgb'],
  ['neptune', 'neptune', 'srgb'],
  ['saturn-rings', 'saturn', 'srgb-alpha']
].map(([key, body, colorSpace]) => ({
  key,
  path: `/textures/${key}.webp`,
  body: body as BodyId,
  sourceDimensions: key === 'uranus' || key === 'neptune' ? [2048, 1024] as const : key === 'saturn-rings' ? [8192, 2048] as const : [8192, 4096] as const,
  encodedDimensions: key === 'saturn-rings' ? [2048, 512] as const : [2048, 1024] as const,
  colorSpace: colorSpace as TextureColorSpace,
  format: 'webp' as const,
  bytes: TEXTURE_BYTES[key as keyof typeof TEXTURE_BYTES]
})))

export const BODY_TEXTURE_KEYS = Object.freeze({
  sun: 'sun', mercury: 'mercury', venus: 'venus', earth: 'earth', mars: 'mars',
  jupiter: 'jupiter', saturn: 'saturn', uranus: 'uranus', neptune: 'neptune'
} satisfies Record<Exclude<BodyId, never>, string>)

export function configureTexture(texture: Texture, colorSpace: TextureColorSpace, maxAnisotropy = MAX_ANISOTROPY): Texture {
  if (colorSpace === 'srgb' || colorSpace === 'srgb-alpha') texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearMipmapLinearFilter
  texture.magFilter = LinearFilter
  texture.anisotropy = Math.min(maxAnisotropy, MAX_ANISOTROPY)
  texture.needsUpdate = true
  return texture
}

export function preloadTextureCatalog(): void {
  for (const entry of TEXTURE_CATALOG) TextureLoader.prototype.load.call(new TextureLoader(), entry.path)
}

export function getTextureEntry(key: string): TextureManifestEntry {
  const entry = TEXTURE_CATALOG.find((candidate) => candidate.key === key)
  if (!entry) throw new Error(`Unknown local texture: ${key}`)
  return entry
}
