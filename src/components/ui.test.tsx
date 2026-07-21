import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PerspectiveCamera } from 'three'
import App from '../App'
import { markPlanetPointerGesture, PointerGravity, pointerGravityPosition } from '../interactions/PointerGravity'
import { getSolarFrame, useSolarStore } from '../state/solarStore'

const pointerMocks = vi.hoisted(() => ({
  canvas: undefined as HTMLCanvasElement | undefined,
  camera: undefined as PerspectiveCamera | undefined,
  frameCallbacks: [] as Array<() => void>
}))

vi.mock('@react-three/fiber', () => ({
  useThree: () => ({
    camera: pointerMocks.camera,
    gl: { domElement: pointerMocks.canvas }
  }),
  useFrame: (callback: () => void) => {
    pointerMocks.frameCallbacks.push(callback)
  }
}))

vi.mock('../rendering/SolarScene', () => ({
  SolarCanvas: ({ selectedBodyId, quality }: { selectedBodyId: string | null; quality: string }) => <div data-testid="solar-canvas" data-selected-body={selectedBodyId ?? ''} data-quality={quality} />
}))

describe('educational control interface', () => {
  beforeEach(() => {
    useSolarStore.getState().resetScene()
    pointerMocks.frameCallbacks.length = 0
    window.matchMedia = (() => ({ matches: false, media: '', onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() })) as typeof window.matchMedia
  })

  afterEach(() => cleanup())

  it('exposes labeled controls that work with keyboard activation', async () => {
    const user = userEvent.setup()
    render(<App />)

    const pause = screen.getByRole('button', { name: 'Pause orbit' })
    pause.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: 'Resume orbit' })).toHaveAttribute('aria-pressed', 'true')

    await user.selectOptions(screen.getByLabelText('Simulation speed'), '2')
    await user.selectOptions(screen.getByLabelText('Render quality'), 'cinematic')
    expect(useSolarStore.getState()).toMatchObject({ paused: true, speed: 2, quality: 'cinematic' })
  })

  it('toggles facts and measurement overlays and renders selected-body facts', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Earth' }))
    await user.click(screen.getByRole('button', { name: 'Show facts' }))
    expect(screen.getByRole('heading', { name: 'Earth' })).toBeInTheDocument()
    expect(screen.getByText('5.97e+24 kg')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show measurements' }))
    expect(screen.getByText('Distances shown in AU')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide facts' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Hide measurements' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps camera reset separate from full scene reset', async () => {
    const user = userEvent.setup()
    const initialToken = useSolarStore.getState().cameraResetToken
    const initialFullSceneToken = useSolarStore.getState().fullSceneResetToken
    useSolarStore.getState().setPaused(true)
    useSolarStore.getState().setSpeed(2)
    useSolarStore.getState().selectBody('earth')
    render(<App />)
    const stage = screen.getByLabelText('Interactive solar system scene')
    const canvas = screen.getByTestId('solar-canvas')
    expect(stage).toHaveAttribute('data-camera-reset', String(initialToken))

    await user.click(screen.getByRole('button', { name: 'Reset camera' }))
    expect(stage).toHaveAttribute('data-camera-reset', String(initialToken + 1))
    expect(screen.getByTestId('solar-canvas')).toBe(canvas)
    expect(useSolarStore.getState()).toMatchObject({ paused: true, speed: 2, selectedBodyId: 'earth', quality: 'balanced', consumedBodyIds: [] })

    await user.click(screen.getByRole('button', { name: 'Reset whole scene' }))
    expect(stage).toHaveAttribute('data-camera-reset', String(initialToken + 1))
    expect(useSolarStore.getState()).toMatchObject({ selectedBodyId: null, paused: false, speed: 1, quality: 'balanced', consumedBodyIds: [], fullSceneResetToken: initialFullSceneToken + 1 })
    expect(getSolarFrame().getSnapshot()).toMatchObject({ hoverAttractor: false, blackHoleLevel: 0, consumedBodyIds: [] })
    expect(getSolarFrame().getBodyState('earth').interaction).toBe('reset')
  })

  it('synchronizes hover gravity on pointer entry and exit without losing its projection on camera reset', () => {
    const canvas = document.createElement('canvas')
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 })
    })
    pointerMocks.canvas = canvas
    pointerMocks.camera = new PerspectiveCamera(46, 1, 0.1, 60)
    pointerMocks.camera.position.set(0, 4.2, 9.6)
    pointerMocks.camera.lookAt(0, 0, 0)
    pointerMocks.camera.updateMatrixWorld()
    pointerMocks.camera.updateProjectionMatrix()

    render(<><App /><PointerGravity /></>)
    act(() => {
      const move = new Event('pointermove', { bubbles: true })
      Object.defineProperties(move, { clientX: { value: 64 }, clientY: { value: 50 } })
      canvas.dispatchEvent(move)
      pointerMocks.frameCallbacks.forEach((callback) => callback())
    })

    const projectedPosition = pointerGravityPosition.clone()
    expect(getSolarFrame().hasHoverAttractor).toBe(true)
    expect(useSolarStore.getState().interaction).toBe('hover-attractor')
    expect(getSolarFrame().getSnapshot().blackHolePosition).toMatchObject({ x: projectedPosition.x, y: projectedPosition.y, z: projectedPosition.z })
    expect(screen.getByText('Hover gravity live')).toBeInTheDocument()

    act(() => useSolarStore.getState().resetCamera())
    expect(getSolarFrame().hasHoverAttractor).toBe(true)
    expect(useSolarStore.getState().interaction).toBe('hover-attractor')
    expect(pointerGravityPosition.x).toBeCloseTo(projectedPosition.x)
    expect(pointerGravityPosition.z).toBeCloseTo(projectedPosition.z)

    act(() => canvas.dispatchEvent(new Event('pointerleave', { bubbles: true })))
    expect(getSolarFrame().hasHoverAttractor).toBe(false)
    expect(useSolarStore.getState().interaction).toBe('inactive')
    expect(pointerGravityPosition.length()).toBe(0)
    expect(screen.getByText('Hover gravity ready')).toBeInTheDocument()
  })

  it('does not restore retained hover gravity after a full reset until pointer movement qualifies again', () => {
    const canvas = document.createElement('canvas')
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 })
    })
    pointerMocks.canvas = canvas
    pointerMocks.camera = new PerspectiveCamera(46, 1, 0.1, 60)
    pointerMocks.camera.position.set(0, 4.2, 9.6)
    pointerMocks.camera.lookAt(0, 0, 0)
    pointerMocks.camera.updateMatrixWorld()
    pointerMocks.camera.updateProjectionMatrix()

    render(<><App /><PointerGravity /></>)
    act(() => {
      const move = new Event('pointermove', { bubbles: true })
      Object.defineProperties(move, { clientX: { value: 64 }, clientY: { value: 50 } })
      canvas.dispatchEvent(move)
      pointerMocks.frameCallbacks.forEach((callback) => callback())
    })
    expect(getSolarFrame().hasHoverAttractor).toBe(true)
    expect(useSolarStore.getState().interaction).toBe('hover-attractor')

    act(() => useSolarStore.getState().resetScene())
    act(() => pointerMocks.frameCallbacks.forEach((callback) => callback()))
    expect(getSolarFrame().hasHoverAttractor).toBe(false)
    expect(pointerGravityPosition.length()).toBe(0)
    expect(useSolarStore.getState()).toMatchObject({ interaction: 'reset', paused: false, speed: 1, selectedBodyId: null, consumedBodyIds: [] })

    act(() => {
      const move = new Event('pointermove', { bubbles: true })
      Object.defineProperties(move, { clientX: { value: 68 }, clientY: { value: 50 } })
      canvas.dispatchEvent(move)
    })
    expect(getSolarFrame().hasHoverAttractor).toBe(true)
    expect(useSolarStore.getState().interaction).toBe('hover-attractor')
  })

  it('uses click-based black-hole guidance', () => {
    render(<App />)
    expect(screen.getByText('Click the field to create a black hole')).toBeInTheDocument()
    expect(screen.getByText(/click to create a black hole/)).toBeInTheDocument()
    expect(document.body.textContent?.toLowerCase()).not.toContain('hold')
  })

  it('selects a rendered planet without activating its click as a black hole, then allows a background click', () => {
    const canvas = document.createElement('canvas')
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 })
    })
    pointerMocks.canvas = canvas
    pointerMocks.camera = new PerspectiveCamera(46, 1, 0.1, 60)
    pointerMocks.camera.position.set(0, 4.2, 9.6)
    pointerMocks.camera.lookAt(0, 0, 0)
    pointerMocks.camera.updateMatrixWorld()
    pointerMocks.camera.updateProjectionMatrix()

    render(<><App /><PointerGravity /></>)
    act(() => {
      const move = new Event('pointermove', { bubbles: true })
      Object.defineProperties(move, { clientX: { value: 56 }, clientY: { value: 50 } })
      canvas.dispatchEvent(move)
    })

    act(() => {
      const down = new Event('pointerdown', { bubbles: true })
      Object.defineProperties(down, { button: { value: 0 }, pointerId: { value: 21 }, clientX: { value: 56 }, clientY: { value: 50 } })
      canvas.dispatchEvent(down)
      markPlanetPointerGesture(21)
      window.dispatchEvent(new CustomEvent('orbitarium:select-body', { detail: 'earth' }))
      const up = new Event('pointerup', { bubbles: true })
      Object.defineProperties(up, { button: { value: 0 }, pointerId: { value: 21 }, clientX: { value: 56 }, clientY: { value: 50 } })
      canvas.dispatchEvent(up)
    })
    expect(useSolarStore.getState().selectedBodyId).toBe('earth')
    expect(getSolarFrame().isBlackHoleActive).toBe(false)

    act(() => {
      const down = new Event('pointerdown', { bubbles: true })
      Object.defineProperties(down, { button: { value: 0 }, pointerId: { value: 22 }, clientX: { value: 56 }, clientY: { value: 50 } })
      const up = new Event('pointerup', { bubbles: true })
      Object.defineProperties(up, { button: { value: 0 }, pointerId: { value: 22 }, clientX: { value: 56 }, clientY: { value: 50 } })
      canvas.dispatchEvent(down)
      canvas.dispatchEvent(up)
    })
    expect(getSolarFrame().isBlackHoleActive).toBe(true)
    expect(useSolarStore.getState().interaction).toBe('black-hole')
  })

  it('announces interaction status and applies reduced-motion classes', () => {
    const originalMatchMedia = window.matchMedia
    window.matchMedia = (() => ({ matches: true, media: '(prefers-reduced-motion: reduce)', onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() })) as typeof window.matchMedia
    render(<App />)
    expect(screen.getByTestId('solar-canvas')).toBeInTheDocument()
    expect(document.querySelector('.app-shell')).toHaveClass('is-reduced-motion')
    expect(screen.getByRole('status')).toHaveTextContent('Baseline restored')
    window.matchMedia = originalMatchMedia
  })
})
