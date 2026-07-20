import { create } from 'zustand'
import type { BodyId } from '../domain/bodies'
import { simulationEngine, type InteractionMode } from '../simulation/engine'

export type QualityPreset = 'eco' | 'balanced' | 'cinematic'

export interface SolarStoreState {
  readonly paused: boolean
  readonly speed: number
  readonly selectedBodyId: BodyId | null
  readonly activeOverlay: 'guide' | 'facts' | 'none'
  readonly quality: QualityPreset
  readonly interaction: InteractionMode
  readonly consumedBodyIds: readonly BodyId[]
  readonly cameraResetToken: number
  readonly setPaused: (paused: boolean) => void
  readonly setSpeed: (speed: number) => void
  readonly selectBody: (bodyId: BodyId | null) => void
  readonly setOverlay: (overlay: SolarStoreState['activeOverlay']) => void
  readonly setQuality: (quality: QualityPreset) => void
  readonly setHoverAttractor: (enabled: boolean) => void
  readonly triggerBlackHole: () => void
  readonly recordConsumption: (bodyId: BodyId) => void
  readonly resetScene: () => void
}

export const useSolarStore = create<SolarStoreState>((set, get) => ({
  paused: false,
  speed: 1,
  selectedBodyId: null,
  activeOverlay: 'guide',
  quality: 'balanced',
  interaction: 'inactive',
  consumedBodyIds: [],
  cameraResetToken: 0,
  setPaused: (paused) => {
    simulationEngine.setPaused(paused)
    const currentInteraction = get().interaction
    const resumedInteraction = currentInteraction === 'absorption'
      ? currentInteraction
      : simulationEngine.isBlackHoleActive
        ? 'black-hole'
        : simulationEngine.hasHoverAttractor
          ? 'hover-attractor'
          : 'inactive'
    set({ paused, interaction: paused ? 'paused' : resumedInteraction })
  },
  setSpeed: (speed) => {
    const nextSpeed = Math.min(4, Math.max(0.25, speed))
    simulationEngine.setSpeed(nextSpeed)
    set({ speed: nextSpeed })
  },
  selectBody: (selectedBodyId) => set({ selectedBodyId }),
  setOverlay: (activeOverlay) => set({ activeOverlay }),
  setQuality: (quality) => set({ quality }),
  setHoverAttractor: (enabled) => {
    simulationEngine.setHoverAttractor(enabled)
    const currentInteraction = get().interaction
    const nextInteraction = enabled
      ? get().paused ? 'paused' : 'hover-attractor'
      : currentInteraction === 'black-hole' || currentInteraction === 'absorption'
        ? currentInteraction
        : get().paused ? 'paused' : 'inactive'
    set({ interaction: nextInteraction })
  },
  triggerBlackHole: () => {
    simulationEngine.triggerBlackHole()
    set({ interaction: 'black-hole' })
  },
  recordConsumption: (bodyId) =>
    set((state) => ({
      interaction: 'absorption',
      consumedBodyIds: state.consumedBodyIds.includes(bodyId) ? state.consumedBodyIds : [...state.consumedBodyIds, bodyId]
    })),
  resetScene: () => {
    simulationEngine.reset()
    set((state) => ({
      paused: false,
      speed: 1,
      selectedBodyId: null,
      activeOverlay: 'guide',
      quality: 'balanced',
      interaction: 'reset',
      consumedBodyIds: [],
      cameraResetToken: state.cameraResetToken + 1
    }))
  }
}))

export const solarStore = useSolarStore

export function getSolarFrame() {
  return simulationEngine
}
