import { useEffect, useState } from 'react'
import { BODY_CATALOG } from './domain/bodies'
import { ControlDock } from './components/ControlDock'
import { PlanetFacts } from './components/PlanetFacts'
import { SceneOverlay } from './components/SceneOverlay'
import { useReducedMotion } from './hooks/useReducedMotion'
import { useSolarStore } from './state/solarStore'
import { SolarCanvas } from './rendering/SolarScene'
import { installDiagnosticsGetter } from './rendering/debugBridge'

function App() {
  const paused = useSolarStore((state) => state.paused)
  const speed = useSolarStore((state) => state.speed)
  const selectedBodyId = useSolarStore((state) => state.selectedBodyId)
  const activeOverlay = useSolarStore((state) => state.activeOverlay)
  const quality = useSolarStore((state) => state.quality)
  const interaction = useSolarStore((state) => state.interaction)
  const consumedBodyIds = useSolarStore((state) => state.consumedBodyIds)
  const cameraResetToken = useSolarStore((state) => state.cameraResetToken)
  const setPaused = useSolarStore((state) => state.setPaused)
  const setSpeed = useSolarStore((state) => state.setSpeed)
  const selectBody = useSolarStore((state) => state.selectBody)
  const resetScene = useSolarStore((state) => state.resetScene)
  const resetCamera = useSolarStore((state) => state.resetCamera)
  const setOverlay = useSolarStore((state) => state.setOverlay)
  const setQuality = useSolarStore((state) => state.setQuality)
  const reducedMotion = useReducedMotion()
  const [showMeasurements, setShowMeasurements] = useState(false)
  const [showLabels, setShowLabels] = useState(true)

  useEffect(() => {
    installDiagnosticsGetter()
    const selectFromScene = (event: Event) => {
      const bodyId = (event as CustomEvent<string>).detail
      if (BODY_CATALOG.some((body) => body.id === bodyId)) selectBody(bodyId as typeof BODY_CATALOG[number]['id'])
    }
    window.addEventListener('orbitarium:select-body', selectFromScene)
    return () => window.removeEventListener('orbitarium:select-body', selectFromScene)
  }, [selectBody])

  const selectedBody = BODY_CATALOG.find((body) => body.id === selectedBodyId) ?? null
  const showFacts = activeOverlay === 'facts'
  const fullReset = () => {
    resetScene()
    setShowMeasurements(false)
    setShowLabels(true)
  }

  return (
    <div className={`app-shell ${reducedMotion ? 'is-reduced-motion' : ''}`} data-reduced-motion={reducedMotion}>
      <a className="skip-link" href="#solar-system-main">Skip to solar system</a>
      <SceneOverlay interaction={interaction} showLabels={showLabels} showMeasurements={showMeasurements} />

      <main id="solar-system-main" className="orbitarium-layout">
        <aside className="catalog-panel" aria-label="Solar body catalog">
          <div className="catalog-heading"><div><p className="eyebrow accent">Central catalog</p><h2>Choose a body</h2></div><span className="panel-count">{BODY_CATALOG.length} objects</span></div>
          <p className="catalog-instruction">Select a world to compare its rhythm with the rest of the system.</p>
          <div className="catalog-list" role="list">
            {BODY_CATALOG.map((body, index) => (
              <button type="button" className={`catalog-item ${selectedBodyId === body.id ? 'is-selected' : ''} ${consumedBodyIds.includes(body.id) ? 'is-consumed' : ''}`} key={body.id} onClick={() => selectBody(selectedBodyId === body.id ? null : body.id)} aria-label={body.name} aria-pressed={selectedBodyId === body.id}>
                <span className={`catalog-swatch swatch-${body.id}`} aria-hidden="true" />
                <span className="catalog-number">{String(index + 1).padStart(2, '0')}</span>
                <span className="catalog-name">{body.name}</span>
                {consumedBodyIds.includes(body.id) ? <span className="catalog-state">gone</span> : <span className="catalog-arrow" aria-hidden="true">↗</span>}
              </button>
            ))}
          </div>
          <div className="catalog-footer"><span className="catalog-footer-dot" /> Browser-only / no account required</div>
        </aside>

        <section className="scene-panel" aria-label="Interactive solar system scene" data-camera-reset={cameraResetToken}>
          <SolarCanvas selectedBodyId={selectedBodyId} quality={quality} />
          <SceneOverlay mode="scene" interaction={interaction} selectedName={selectedBody?.name} showLabels={showLabels} showMeasurements={showMeasurements} quality={quality} reducedMotion={reducedMotion} />
          <ControlDock paused={paused} speed={speed} quality={quality} showFacts={showFacts} showMeasurements={showMeasurements} onPausedChange={setPaused} onSpeedChange={setSpeed} onQualityChange={setQuality} onFactsChange={(visible) => setOverlay(visible ? 'facts' : 'none')} onMeasurementsChange={setShowMeasurements} onCameraReset={resetCamera} onFullReset={fullReset} />
        </section>

        <PlanetFacts body={showFacts ? selectedBody : null} isConsumed={selectedBodyId ? consumedBodyIds.includes(selectedBodyId) : false} />
      </main>

      <footer className="bottom-bar">
        <div className="footer-status"><span className="eyebrow">Interaction</span><span className="interaction-state">{interaction.replace('-', ' ')}</span></div>
        <div className="footer-tools"><button type="button" className={`label-toggle ${showLabels ? 'active' : ''}`} onClick={() => setShowLabels(!showLabels)} aria-pressed={showLabels}>Orbit labels {showLabels ? 'on' : 'off'}</button><span className="footer-divider" aria-hidden="true" /><span className="footer-credit">Stylized gravity · local textures · 60 fps target</span></div>
      </footer>
    </div>
  )
}

export default App
