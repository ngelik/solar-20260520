import { useEffect } from 'react'
import { BODY_CATALOG } from './domain/bodies'
import { useSolarStore } from './state/solarStore'

function App() {
  const paused = useSolarStore((state) => state.paused)
  const speed = useSolarStore((state) => state.speed)
  const selectedBodyId = useSolarStore((state) => state.selectedBodyId)
  const activeOverlay = useSolarStore((state) => state.activeOverlay)
  const interaction = useSolarStore((state) => state.interaction)
  const setPaused = useSolarStore((state) => state.setPaused)
  const setSpeed = useSolarStore((state) => state.setSpeed)
  const selectBody = useSolarStore((state) => state.selectBody)
  const resetScene = useSolarStore((state) => state.resetScene)
  const setOverlay = useSolarStore((state) => state.setOverlay)

  useEffect(() => {
    Object.defineProperty(window, '__orbitariumDiagnostics', {
      configurable: true,
      value: { sceneReady: true, lastError: null, frameCount: 0 }
    })
  }, [])

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Orbitarium home">
          <span className="brand-mark" aria-hidden="true">◒</span>
          <span>Orbitarium</span>
        </a>
        <div className="topbar-meta">
          <span className="eyebrow">Field guide / 01</span>
          <span className="status-dot" aria-label="Simulation ready">Ready</span>
        </div>
      </header>

      <main className="guide-layout">
        <section className="intro-panel" aria-labelledby="page-title">
          <p className="eyebrow accent">A small map of a vast place</p>
          <h1 id="page-title">The solar system,<br /><em>in motion.</em></h1>
          <p className="intro-copy">Trace the rhythm of the planets, then disturb it. This is a stylized, explorable model built for curiosity—not perfect scale.</p>
          <div className="intro-rule" />
          <div className="intro-stat">
            <span className="stat-value">09</span>
            <span className="stat-label">bodies in the<br />central catalog</span>
          </div>
        </section>

        <section className="scene-panel" aria-label="Interactive solar system scene">
          <div className="scene-grid" aria-hidden="true" />
          <div className="orbit-orbit orbit-one" aria-hidden="true" />
          <div className="orbit-orbit orbit-two" aria-hidden="true" />
          <div className="orbit-orbit orbit-three" aria-hidden="true" />
          <div className="scene-sun" aria-hidden="true"><span /></div>
          <div className="scene-planet planet-mercury" aria-hidden="true" />
          <div className="scene-planet planet-earth" aria-hidden="true" />
          <div className="scene-planet planet-jupiter" aria-hidden="true" />
          <div className="scene-label label-sun">Sun <span>01</span></div>
          <div className="scene-label label-earth">Earth <span>03</span></div>
          <div className="scene-note">Drag through the field<br /><span>gravity is softened for play</span></div>
          <div className="scene-caption"><span className="live-pulse" /> live orbital baseline</div>
          <div className="scene-controls" role="group" aria-label="Scene controls">
            <button type="button" className="control-button" onClick={() => setPaused(!paused)} aria-pressed={paused}>{paused ? 'Resume' : 'Pause'}</button>
            <button type="button" className="control-button" onClick={() => setSpeed(speed >= 4 ? 0.25 : speed + 0.25)}>Speed ×{speed.toFixed(2)}</button>
            <button type="button" className="control-button reset-button" onClick={resetScene}>Reset field</button>
          </div>
        </section>

        <aside className="catalog-panel" aria-label="Solar body catalog">
          <div className="panel-heading">
            <span className="eyebrow">Navigation</span>
            <span className="panel-count">{BODY_CATALOG.length} objects</span>
          </div>
          <div className="catalog-list" role="list">
            {BODY_CATALOG.map((body, index) => (
              <button
                type="button"
                className={`catalog-item ${selectedBodyId === body.id ? 'is-selected' : ''}`}
                key={body.id}
                onClick={() => selectBody(selectedBodyId === body.id ? null : body.id)}
                role="listitem"
                aria-pressed={selectedBodyId === body.id}
              >
                <span className={`catalog-swatch swatch-${body.id}`} aria-hidden="true" />
                <span className="catalog-number">{String(index + 1).padStart(2, '0')}</span>
                <span className="catalog-name">{body.name}</span>
                <span className="catalog-arrow" aria-hidden="true">↗</span>
              </button>
            ))}
          </div>
        </aside>
      </main>

      <footer className="bottom-bar">
        <div className="footer-status"><span className="eyebrow">Interaction</span><span className="interaction-state">{interaction.replace('-', ' ')}</span></div>
        <div className="footer-tabs" role="tablist" aria-label="Information panels">
          <button type="button" className={activeOverlay === 'guide' ? 'active' : ''} onClick={() => setOverlay('guide')} role="tab" aria-selected={activeOverlay === 'guide'}>Guide</button>
          <button type="button" className={activeOverlay === 'facts' ? 'active' : ''} onClick={() => setOverlay('facts')} role="tab" aria-selected={activeOverlay === 'facts'}>Quick facts</button>
          <button type="button" className={activeOverlay === 'none' ? 'active' : ''} onClick={() => setOverlay('none')} role="tab" aria-selected={activeOverlay === 'none'}>Clear</button>
        </div>
        <span className="footer-credit">Browser-only / no backend</span>
      </footer>
    </div>
  )
}

export default App
