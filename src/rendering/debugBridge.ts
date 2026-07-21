import type { BodyId } from '../domain/bodies'

export interface RenderBodyDiagnostic {
  readonly id: BodyId
  readonly x: number
  readonly y: number
  readonly z: number
}

export interface RenderScreenBounds {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly centerX: number
  readonly centerY: number
  readonly visible: boolean
}

export interface RenderDiagnostics {
  readonly sceneReady: boolean
  readonly renderer: string
  readonly textureDimensions: Readonly<Record<string, readonly [number, number]>>
  readonly simulationTime: number
  readonly bodyPositions: readonly RenderBodyDiagnostic[]
  readonly screenSpaceBounds: Readonly<Record<string, RenderScreenBounds>>
  readonly frameCount: number
  readonly qualityTier: string
  readonly interactionState: string
  readonly absorptionState: string
  readonly lastError: string | null
}

const emptyDiagnostics: RenderDiagnostics = Object.freeze({
  sceneReady: false,
  renderer: 'pending',
  textureDimensions: {},
  simulationTime: 0,
  bodyPositions: [],
  screenSpaceBounds: {},
  frameCount: 0,
  qualityTier: 'balanced',
  interactionState: 'inactive',
  absorptionState: 'none',
  lastError: null
})

let currentDiagnostics = emptyDiagnostics

export function publishRenderDiagnostics(next: RenderDiagnostics): void {
  currentDiagnostics = Object.freeze({
    ...next,
    textureDimensions: Object.freeze({ ...next.textureDimensions }),
    bodyPositions: Object.freeze(next.bodyPositions.map((body) => Object.freeze({ ...body }))),
    screenSpaceBounds: Object.freeze(Object.fromEntries(Object.entries(next.screenSpaceBounds).map(([key, bounds]) => [key, Object.freeze({ ...bounds })])))
  })
}

export function getRenderDiagnostics(): RenderDiagnostics {
  return currentDiagnostics
}

export function installDiagnosticsGetter(): void {
  Object.defineProperty(window, '__orbitariumDiagnostics', {
    configurable: true,
    get: getRenderDiagnostics
  })
}
