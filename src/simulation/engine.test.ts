import { BODY_CATALOG } from '../domain/bodies'
import { SIMULATION_CONSTANTS, SolarSimulationEngine } from './engine'

function advanceFor(engine: SolarSimulationEngine, seconds: number): void {
  const steps = Math.ceil(seconds / 0.1)
  for (let index = 0; index < steps; index += 1) engine.advance(0.1)
}

describe('solar simulation engine', () => {
  it('advances a deterministic Kepler-like orbital baseline', () => {
    const engine = new SolarSimulationEngine({ seed: 21 })
    const initial = { x: engine.getBodyState('earth').x, z: engine.getBodyState('earth').z }
    engine.advance(0.1)
    const next = engine.getBodyState('earth')
    expect(Math.hypot(next.x - initial.x, next.z - initial.z)).toBeGreaterThan(0)
    expect(next.rotation).toBeGreaterThan(0)
  })

  it('pauses and scales time without changing the nominal source mass', () => {
    const paused = new SolarSimulationEngine({ seed: 21 })
    const before = paused.getSnapshot()
    paused.setPaused(true)
    paused.advance(1)
    expect(paused.getSnapshot().elapsedSeconds).toBe(before.elapsedSeconds)
    expect(paused.getBodyState('earth').interaction).toBe('paused')

    const slow = new SolarSimulationEngine({ seed: 21 })
    const fast = new SolarSimulationEngine({ seed: 21 })
    slow.setSpeed(0.25)
    fast.setSpeed(4)
    slow.advance(0.1)
    fast.advance(0.1)
    expect(Math.abs(fast.getBodyState('earth').rotation)).toBeGreaterThan(Math.abs(slow.getBodyState('earth').rotation))
    expect(fast.hoverMassJupiter).toBe(10)
    expect(SIMULATION_CONSTANTS.JUPITER_MASS_KG).toBe(BODY_CATALOG[5].massKg)
  })

  it('softens and amplifies hover attraction while keeping velocity bounded', () => {
    const near = new SolarSimulationEngine({ seed: 3 })
    const far = new SolarSimulationEngine({ seed: 3 })
    near.setHoverAttractor(true, { x: 0, y: 0, z: 0 })
    far.setHoverAttractor(true, { x: 6, y: 0, z: 6 })
    near.advance(0.1)
    far.advance(0.1)
    expect(Math.hypot(near.getBodyState('mercury').velocityX, near.getBodyState('mercury').velocityZ)).toBeGreaterThan(
      Math.hypot(far.getBodyState('mercury').velocityX, far.getBodyState('mercury').velocityZ)
    )
    for (const state of near.bodies) expect(Math.abs(state.velocityX)).toBeLessThanOrEqual(SIMULATION_CONSTANTS.MAX_VELOCITY)
  })

  it('escalates a black hole through ordered absorption stages to consumption', () => {
    const engine = new SolarSimulationEngine({ seed: 9 })
    const mercury = engine.getBodyState('mercury')
    engine.triggerBlackHole({ x: mercury.x, y: 0, z: mercury.z })
    engine.advance(0.1)
    expect(engine.getBodyState('mercury').absorptionStage).toBe('tidal')
    expect(engine.blackHoleEscalation).toBeGreaterThan(0.08)
    advanceFor(engine, 0.7)
    expect(['collapse', 'fade', 'consumed']).toContain(engine.getBodyState('mercury').absorptionStage)
    advanceFor(engine, 3)
    expect(engine.getBodyState('mercury').absorptionStage).toBe('consumed')
    expect(engine.getSnapshot().consumedBodyIds).toContain('mercury')
    expect(engine.getBodyState('mercury').finalConsumption).toBe(1)
  })

  it('restores the exact seeded baseline on reset', () => {
    const engine = new SolarSimulationEngine({ seed: 44 })
    const initial = engine.getSnapshot()
    engine.setSpeed(4)
    engine.setHoverAttractor(true, { x: 2, y: 0, z: -1 })
    engine.advance(0.8)
    engine.reset()
    const restored = engine.getSnapshot()
    expect(restored.elapsedSeconds).toBe(0)
    expect(restored.speed).toBe(1)
    expect(restored.hoverAttractor).toBe(false)
    expect(restored.consumedBodyIds).toEqual([])
    expect(restored.bodies.map(({ id, x, z }) => ({ id, x, z }))).toEqual(initial.bodies.map(({ id, x, z }) => ({ id, x, z })))
    expect(engine.getBodyState('mercury').interaction).toBe('reset')
  })
})
