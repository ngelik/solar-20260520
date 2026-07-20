import { BODY_CATALOG, PLANET_IDS } from './bodies'

describe('central body catalog', () => {
  it('contains nine uniquely identified bodies in exact outward order', () => {
    expect(BODY_CATALOG.map((body) => body.id)).toEqual([
      'sun', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'
    ])
    expect(new Set(BODY_CATALOG.map((body) => body.id)).size).toBe(9)
    expect(PLANET_IDS).toEqual(['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'])
  })

  it('has complete physical, educational, and texture fields', () => {
    for (const [index, body] of BODY_CATALOG.entries()) {
      expect(body.name).toBeTruthy()
      expect(body.facts.length).toBeGreaterThanOrEqual(2)
      expect(body.caveat).toMatch(/[A-Za-z]/)
      expect(body.massKg).toBeGreaterThan(0)
      expect(body.radiusKm).toBeGreaterThan(0)
      expect(body.textureKey).toMatch(/^[a-z-]+$/)
      expect(body.presentationScale).toBeGreaterThan(0)
      expect(body.presentationRadius).toBeGreaterThan(0)
      if (index > 0) {
        expect(body.distanceAu).toBeGreaterThan(BODY_CATALOG[index - 1].distanceAu)
        expect(body.orbitalSpeedKmPerSecond).toBeGreaterThan(0)
        expect(body.orbitalPeriodDays).toBeGreaterThan(0)
      }
    }
  })
})
