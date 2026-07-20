/// <reference types="vite/client" />

interface BrowserDiagnostics {
  readonly sceneReady: boolean
  readonly lastError: string | null
  readonly frameCount: number
}

interface Window {
  readonly __orbitariumDiagnostics?: BrowserDiagnostics
}
