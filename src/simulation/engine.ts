import { BODY_CATALOG, type BodyDefinition, type BodyId } from '../domain/bodies'

export type InteractionMode = 'inactive' | 'hover-attractor' | 'black-hole' | 'absorption' | 'paused' | 'reset'
export type AbsorptionStage = 'none' | 'tidal' | 'collapse' | 'fade' | 'consumed'

export interface Vector3Like {
  readonly x: number
  readonly y: number
  readonly z: number
}

export interface BodySimulationState {
  readonly id: BodyId
  x: number
  y: number
  z: number
  velocityX: number
  velocityY: number
  velocityZ: number
  rotation: number
  active: boolean
  interaction: InteractionMode
  absorptionStage: AbsorptionStage
  absorptionProgress: number
  tidalElongation: number
  shrink: number
  fade: number
  lensingIntensity: number
  finalConsumption: number
}

export interface SimulationSnapshot {
  readonly elapsedSeconds: number
  readonly speed: number
  readonly paused: boolean
  readonly hoverAttractor: boolean
  readonly hoverMassJupiter: number
  readonly blackHoleLevel: number
  readonly blackHolePosition: Vector3Like
  readonly consumedBodyIds: readonly BodyId[]
  readonly bodies: readonly BodySimulationState[]
}

export interface SimulationEngineOptions {
  readonly seed?: number
  readonly presentationAmplification?: number
}

const JUPITER_MASS_KG = 1.8982e27
const NOMINAL_HOVER_MASS_JUPITERS = 10
const MAX_ACCELERATION = 0.85
const MAX_VELOCITY = 1.8
const MAX_PERTURBATION = 0.055
const ORBIT_DIAMETER = 7.2
const ORBIT_SECONDS_PER_EARTH_YEAR = 90
const SOFTENING = 0.72
const TIDAL_SECONDS = 0.7
const COLLAPSE_SECONDS = 0.75
const FADE_SECONDS = 0.9

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function hashSeed(seed: number, index: number): number {
  const value = Math.sin(seed * 12.9898 + index * 78.233) * 43758.5453
  return value - Math.floor(value)
}

function createState(body: BodyDefinition, index: number, seed: number): BodySimulationState {
  const radius = body.kind === 'star' ? 0 : 0.95 + Math.log1p(body.distanceAu) * 1.33
  const angle = body.kind === 'star' ? 0 : hashSeed(seed, index) * Math.PI * 2
  return {
    id: body.id,
    x: radius * Math.cos(angle),
    y: 0,
    z: radius * Math.sin(angle),
    velocityX: 0,
    velocityY: 0,
    velocityZ: 0,
    rotation: 0,
    active: true,
    interaction: 'inactive',
    absorptionStage: 'none',
    absorptionProgress: 0,
    tidalElongation: 1,
    shrink: 1,
    fade: 1,
    lensingIntensity: 0,
    finalConsumption: 0
  }
}

export class SolarSimulationEngine {
  readonly hoverMassJupiter = NOMINAL_HOVER_MASS_JUPITERS
  readonly presentationAmplification: number
  readonly bodies: readonly BodySimulationState[]

  private readonly seed: number
  private readonly initialStates: readonly BodySimulationState[]
  private readonly consumedBodyIds: BodyId[] = []
  private elapsedSeconds = 0
  private speed = 1
  private paused = false
  private hoverAttractor = false
  private blackHoleLevel = 0
  private blackHoleActive = false
  private blackHolePosition = { x: 0, y: 0, z: 0 }

  constructor(options: SimulationEngineOptions = {}) {
    this.seed = options.seed ?? 17
    this.presentationAmplification = options.presentationAmplification ?? 3.2
    this.bodies = BODY_CATALOG.map((body, index) => createState(body, index, this.seed))
    this.initialStates = this.bodies.map((state) => ({ ...state }))
  }

  get isPaused(): boolean {
    return this.paused
  }

  get currentSpeed(): number {
    return this.speed
  }

  get blackHoleEscalation(): number {
    return this.blackHoleLevel
  }

  get isBlackHoleActive(): boolean {
    return this.blackHoleActive
  }

  get hasHoverAttractor(): boolean {
    return this.hoverAttractor
  }

  setSpeed(speed: number): void {
    this.speed = clamp(speed, 0.25, 4)
  }

  setPaused(paused: boolean): void {
    this.paused = paused
    for (const state of this.bodies) {
      if (!state.active || state.absorptionStage !== 'none') continue
      state.interaction = paused ? 'paused' : this.blackHoleActive ? 'black-hole' : this.hoverAttractor ? 'hover-attractor' : 'inactive'
    }
  }

  setHoverAttractor(enabled: boolean, position: Vector3Like = { x: 0, y: 0, z: 0 }): void {
    this.hoverAttractor = enabled
    this.blackHolePosition.x = position.x
    this.blackHolePosition.y = position.y
    this.blackHolePosition.z = position.z
    if (this.blackHoleActive) return
    for (const state of this.bodies) {
      if (state.active && state.absorptionStage === 'none') state.interaction = enabled ? 'hover-attractor' : this.paused ? 'paused' : 'inactive'
    }
  }

  triggerBlackHole(position: Vector3Like = this.blackHolePosition): void {
    this.blackHoleActive = true
    this.hoverAttractor = true
    this.blackHoleLevel = Math.max(this.blackHoleLevel, 0.08)
    this.blackHolePosition.x = position.x
    this.blackHolePosition.y = position.y
    this.blackHolePosition.z = position.z
    for (const state of this.bodies) {
      if (state.active && state.absorptionStage === 'none') state.interaction = 'black-hole'
    }
  }

  advance(deltaSeconds: number): void {
    if (this.paused || deltaSeconds <= 0) return
    const delta = Math.min(deltaSeconds, 0.1) * this.speed
    this.elapsedSeconds += delta
    if (this.blackHoleActive) this.blackHoleLevel = clamp(this.blackHoleLevel + delta * 0.42, 0, 1)

    for (let index = 1; index < this.bodies.length; index += 1) {
      const state = this.bodies[index]
      const body = BODY_CATALOG[index]
      if (!state.active) continue
      if (state.absorptionStage !== 'none') {
        this.advanceAbsorption(state, delta)
        continue
      }

      const orbitRadius = 0.95 + Math.log1p(body.distanceAu) * 1.33
      const angularVelocity = (Math.PI * 2 * ORBIT_SECONDS_PER_EARTH_YEAR) / body.orbitalPeriodDays
      const angle = Math.atan2(state.z, state.x) + angularVelocity * delta
      const baselineX = orbitRadius * Math.cos(angle)
      const baselineZ = orbitRadius * Math.sin(angle)
      const jitter = Math.sin(this.elapsedSeconds * 1.7 + index * 2.1) * MAX_PERTURBATION
      // Keep the baseline deliberately soft so the capped cursor force remains
      // perceptible instead of being hidden behind the acceleration ceiling.
      let accelerationX = (baselineX - state.x) * 0.22 / Math.max(delta, 0.016)
      let accelerationZ = (baselineZ - state.z) * 0.22 / Math.max(delta, 0.016)

      if (this.hoverAttractor || this.blackHoleActive) {
        const dx = this.blackHolePosition.x - state.x
        const dz = this.blackHolePosition.z - state.z
        const softenedDistanceSquared = dx * dx + dz * dz + SOFTENING * SOFTENING
        const massRatio = NOMINAL_HOVER_MASS_JUPITERS * (this.blackHoleActive ? 1 + this.blackHoleLevel * 3.5 : 1)
        const force = (0.025 * massRatio * this.presentationAmplification) / softenedDistanceSquared
        accelerationX += dx * force
        accelerationZ += dz * force
        if (this.blackHoleActive && Math.sqrt(dx * dx + dz * dz) < 0.7 + this.blackHoleLevel * 1.65) {
          state.absorptionStage = 'tidal'
          state.absorptionProgress = 0
          state.interaction = 'absorption'
        }
      }

      const accelerationMagnitude = Math.hypot(accelerationX, accelerationZ)
      if (accelerationMagnitude > MAX_ACCELERATION) {
        const scale = MAX_ACCELERATION / accelerationMagnitude
        accelerationX *= scale
        accelerationZ *= scale
      }
      state.velocityX = clamp(state.velocityX * 0.84 + accelerationX * delta, -MAX_VELOCITY, MAX_VELOCITY)
      state.velocityZ = clamp(state.velocityZ * 0.84 + accelerationZ * delta, -MAX_VELOCITY, MAX_VELOCITY)
      state.x = clamp(state.x + state.velocityX * delta + jitter * delta, -ORBIT_DIAMETER, ORBIT_DIAMETER)
      state.z = clamp(state.z + state.velocityZ * delta - jitter * delta * 0.7, -ORBIT_DIAMETER, ORBIT_DIAMETER)
      state.rotation += (Math.PI * 2 * delta * 24) / Math.abs(body.axialRotationHours)
    }

    if (this.blackHoleActive) {
      const sun = this.bodies[0]
      sun.lensingIntensity = clamp(0.35 + this.blackHoleLevel * 0.65, 0, 1)
      sun.interaction = 'black-hole'
    }
  }

  private advanceAbsorption(state: BodySimulationState, delta: number): void {
    const durations: Record<Exclude<AbsorptionStage, 'none' | 'consumed'>, number> = {
      tidal: TIDAL_SECONDS,
      collapse: COLLAPSE_SECONDS,
      fade: FADE_SECONDS
    }
    state.absorptionProgress += delta / durations[state.absorptionStage as keyof typeof durations]
    const progress = clamp(state.absorptionProgress, 0, 1)
    if (state.absorptionStage === 'tidal') {
      state.tidalElongation = 1 + progress * 1.8
      state.shrink = 1 - progress * 0.1
      state.lensingIntensity = progress * 0.3
      if (progress >= 1) {
        state.absorptionStage = 'collapse'
        state.absorptionProgress = 0
      }
    } else if (state.absorptionStage === 'collapse') {
      state.tidalElongation = 2.8 - progress * 1.2
      state.shrink = 0.9 - progress * 0.55
      state.lensingIntensity = 0.3 + progress * 0.5
      if (progress >= 1) {
        state.absorptionStage = 'fade'
        state.absorptionProgress = 0
      }
    } else if (state.absorptionStage === 'fade') {
      state.tidalElongation = 1.6
      state.shrink = 0.35 - progress * 0.35
      state.fade = 1 - progress
      state.lensingIntensity = 0.8 + progress * 0.2
      if (progress >= 1) {
        state.absorptionStage = 'consumed'
        state.absorptionProgress = 1
        state.active = false
        state.finalConsumption = 1
        state.fade = 0
        state.shrink = 0
        if (!this.consumedBodyIds.includes(state.id)) this.consumedBodyIds.push(state.id)
      }
    }
  }

  getBodyState(id: BodyId): BodySimulationState {
    const state = this.bodies.find((candidate) => candidate.id === id)
    if (!state) throw new Error(`Unknown simulation body: ${id}`)
    return state
  }

  getSnapshot(): SimulationSnapshot {
    return {
      elapsedSeconds: this.elapsedSeconds,
      speed: this.speed,
      paused: this.paused,
      hoverAttractor: this.hoverAttractor,
      hoverMassJupiter: this.hoverMassJupiter,
      blackHoleLevel: this.blackHoleLevel,
      blackHolePosition: { ...this.blackHolePosition },
      consumedBodyIds: [...this.consumedBodyIds],
      bodies: this.bodies.map((state) => ({ ...state }))
    }
  }

  reset(): void {
    this.elapsedSeconds = 0
    this.speed = 1
    this.paused = false
    this.hoverAttractor = false
    this.blackHoleActive = false
    this.blackHoleLevel = 0
    this.blackHolePosition.x = 0
    this.blackHolePosition.y = 0
    this.blackHolePosition.z = 0
    this.consumedBodyIds.length = 0
    for (let index = 0; index < this.bodies.length; index += 1) {
      Object.assign(this.bodies[index], this.initialStates[index], { interaction: 'reset' })
    }
  }
}

export const simulationEngine = new SolarSimulationEngine()

export const SIMULATION_CONSTANTS = {
  JUPITER_MASS_KG,
  NOMINAL_HOVER_MASS_JUPITERS,
  MAX_ACCELERATION,
  MAX_VELOCITY,
  SOFTENING,
  TIDAL_SECONDS,
  COLLAPSE_SECONDS,
  FADE_SECONDS
} as const
