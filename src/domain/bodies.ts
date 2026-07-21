export type BodyId =
  | 'sun'
  | 'mercury'
  | 'venus'
  | 'earth'
  | 'mars'
  | 'jupiter'
  | 'saturn'
  | 'uranus'
  | 'neptune'

export type BodyKind = 'star' | 'planet'

export interface BodyDefinition {
  readonly id: BodyId
  readonly name: string
  readonly kind: BodyKind
  readonly facts: readonly string[]
  readonly caveat: string
  readonly massKg: number
  readonly distanceAu: number
  readonly radiusKm: number
  readonly orbitalSpeedKmPerSecond: number
  readonly orbitalPeriodDays: number
  readonly axialRotationHours: number
  readonly presentationScale: number
  readonly presentationRadius: number
  readonly textureKey: string
}

export const BODY_CATALOG = [
  {
    id: 'sun',
    name: 'Sun',
    kind: 'star',
    facts: ['The system’s anchor', 'Contains 99.8% of its mass'],
    caveat: 'The Sun is shown smaller than its true scale so the planets remain legible.',
    massKg: 1.9885e30,
    distanceAu: 0,
    radiusKm: 696340,
    orbitalSpeedKmPerSecond: 0,
    orbitalPeriodDays: 0,
    axialRotationHours: 609.12,
    presentationScale: 1,
    presentationRadius: 0.7,
    textureKey: 'sun-granulation'
  },
  {
    id: 'mercury',
    name: 'Mercury',
    kind: 'planet',
    facts: ['Smallest planet', 'A year lasts 88 Earth days'],
    caveat: 'Orbital distances and diameters are compressed for a readable overview.',
    massKg: 3.3011e23,
    distanceAu: 0.39,
    radiusKm: 2439.7,
    orbitalSpeedKmPerSecond: 47.36,
    orbitalPeriodDays: 87.97,
    axialRotationHours: 1407.6,
    presentationScale: 1.15,
    presentationRadius: 0.12,
    textureKey: 'mercury-crater'
  },
  {
    id: 'venus',
    name: 'Venus',
    kind: 'planet',
    facts: ['Hottest planet', 'Rotates in the opposite direction'],
    caveat: 'Its thick cloud deck is represented with a warm, hazy presentation texture.',
    massKg: 4.8675e24,
    distanceAu: 0.72,
    radiusKm: 6051.8,
    orbitalSpeedKmPerSecond: 35.02,
    orbitalPeriodDays: 224.7,
    axialRotationHours: -5832.5,
    presentationScale: 1.12,
    presentationRadius: 0.18,
    textureKey: 'venus-cloud'
  },
  {
    id: 'earth',
    name: 'Earth',
    kind: 'planet',
    facts: ['Liquid surface oceans', 'One natural satellite'],
    caveat: 'Clouds, atmosphere, and the Moon are omitted from this core model.',
    massKg: 5.9722e24,
    distanceAu: 1,
    radiusKm: 6371,
    orbitalSpeedKmPerSecond: 29.78,
    orbitalPeriodDays: 365.25,
    axialRotationHours: 23.934,
    presentationScale: 1.14,
    presentationRadius: 0.2,
    textureKey: 'earth-ocean'
  },
  {
    id: 'mars',
    name: 'Mars',
    kind: 'planet',
    facts: ['Home to Olympus Mons', 'A day is 24.6 hours'],
    caveat: 'A simplified circular orbit makes comparisons easier than a true ephemeris.',
    massKg: 6.4171e23,
    distanceAu: 1.52,
    radiusKm: 3389.5,
    orbitalSpeedKmPerSecond: 24.07,
    orbitalPeriodDays: 686.98,
    axialRotationHours: 24.623,
    presentationScale: 1.13,
    presentationRadius: 0.15,
    textureKey: 'mars-iron'
  },
  {
    id: 'jupiter',
    name: 'Jupiter',
    kind: 'planet',
    facts: ['Largest planet', 'A storm larger than Earth'],
    caveat: 'The Great Red Spot is suggested by the palette, not simulated as weather.',
    massKg: 1.8982e27,
    distanceAu: 5.2,
    radiusKm: 69911,
    orbitalSpeedKmPerSecond: 13.07,
    orbitalPeriodDays: 4332.59,
    axialRotationHours: 9.925,
    presentationScale: 0.88,
    presentationRadius: 0.43,
    textureKey: 'jupiter-bands'
  },
  {
    id: 'saturn',
    name: 'Saturn',
    kind: 'planet',
    facts: ['Bright ring system', 'Less dense than water'],
    caveat: 'The rings are presentation geometry; their particles are not individually modeled.',
    massKg: 5.6834e26,
    distanceAu: 9.54,
    radiusKm: 58232,
    orbitalSpeedKmPerSecond: 9.69,
    orbitalPeriodDays: 10759.22,
    axialRotationHours: 10.656,
    presentationScale: 0.82,
    presentationRadius: 0.36,
    textureKey: 'saturn-ice'
  },
  {
    id: 'uranus',
    name: 'Uranus',
    kind: 'planet',
    facts: ['Rotates on its side', 'Ice giant with faint rings'],
    caveat: 'Axial tilt is reserved for the presentation layer; the core stores rotation period.',
    massKg: 8.681e25,
    distanceAu: 19.19,
    radiusKm: 25362,
    orbitalSpeedKmPerSecond: 6.81,
    orbitalPeriodDays: 30688.5,
    axialRotationHours: -17.24,
    presentationScale: 0.72,
    presentationRadius: 0.27,
    textureKey: 'uranus-cyan'
  },
  {
    id: 'neptune',
    name: 'Neptune',
    kind: 'planet',
    facts: ['Fastest planetary winds', 'A year lasts 165 Earth years'],
    caveat: 'The outer system is compressed dramatically; relative order remains faithful.',
    massKg: 1.02413e26,
    distanceAu: 30.07,
    radiusKm: 24622,
    orbitalSpeedKmPerSecond: 5.43,
    orbitalPeriodDays: 60182,
    axialRotationHours: 16.11,
    presentationScale: 0.72,
    presentationRadius: 0.26,
    textureKey: 'neptune-storm'
  }
] as const satisfies readonly BodyDefinition[]

export const PLANET_IDS = BODY_CATALOG.slice(1).map((body) => body.id) as readonly Exclude<BodyId, 'sun'>[]

export function getBody(id: BodyId): BodyDefinition {
  const body = BODY_CATALOG.find((candidate) => candidate.id === id)
  if (!body) throw new Error(`Unknown solar body: ${id}`)
  return body
}
