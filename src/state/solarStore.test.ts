import { beforeEach, describe, expect, it } from 'vitest'
import { useSolarStore } from './solarStore'

describe('solar UI store', () => {
  beforeEach(() => {
    useSolarStore.getState().resetScene()
  })

  it('transitions controls, overlays, selection, and quality', () => {
    const store = useSolarStore.getState()
    store.setPaused(true)
    store.setSpeed(2.5)
    store.setOverlay('facts')
    store.selectBody('saturn')
    store.setQuality('cinematic')
    expect(useSolarStore.getState()).toMatchObject({ paused: true, speed: 2.5, activeOverlay: 'facts', selectedBodyId: 'saturn', quality: 'cinematic', interaction: 'paused' })
  })

  it('records black-hole and consumption bookkeeping', () => {
    const store = useSolarStore.getState()
    store.setHoverAttractor(true)
    expect(useSolarStore.getState().interaction).toBe('hover-attractor')
    store.triggerBlackHole()
    expect(useSolarStore.getState().interaction).toBe('black-hole')
    store.recordConsumption('mercury')
    store.recordConsumption('mercury')
    expect(useSolarStore.getState().consumedBodyIds).toEqual(['mercury'])
    expect(useSolarStore.getState().interaction).toBe('absorption')
  })

  it('keeps store interaction state aligned across pause and hover transitions', () => {
    const store = useSolarStore.getState()
    store.setHoverAttractor(true)
    store.setPaused(true)
    expect(useSolarStore.getState().interaction).toBe('paused')
    store.setHoverAttractor(false)
    expect(useSolarStore.getState().interaction).toBe('paused')
    store.setPaused(false)
    expect(useSolarStore.getState().interaction).toBe('inactive')
    store.triggerBlackHole()
    store.setPaused(true)
    store.setPaused(false)
    expect(useSolarStore.getState().interaction).toBe('black-hole')
  })

  it('resets scene state and advances the camera reset token', () => {
    const before = useSolarStore.getState().cameraResetToken
    const store = useSolarStore.getState()
    store.selectBody('neptune')
    store.setOverlay('facts')
    store.setQuality('eco')
    store.recordConsumption('earth')
    store.resetScene()
    expect(useSolarStore.getState()).toMatchObject({ paused: false, speed: 1, selectedBodyId: null, activeOverlay: 'guide', quality: 'balanced', interaction: 'reset', consumedBodyIds: [], cameraResetToken: before + 1 })
  })
})
