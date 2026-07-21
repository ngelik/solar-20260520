import type { QualityPreset } from '../state/solarStore'

type InteractionState = 'inactive' | 'paused' | 'hover-attractor' | 'black-hole' | 'absorption' | 'reset'

interface SceneOverlayProps {
  readonly mode?: 'header' | 'scene'
  readonly interaction: InteractionState
  readonly selectedName?: string
  readonly showLabels: boolean
  readonly showMeasurements: boolean
  readonly quality?: QualityPreset
  readonly loading?: boolean
  readonly reducedMotion?: boolean
}

function interactionCopy(interaction: InteractionState): string {
  switch (interaction) {
    case 'paused': return 'Orbit paused — resume when ready'
    case 'hover-attractor': return 'Hover gravity live — move through the field'
    case 'black-hole': return 'Black hole active — click the field to bend the system'
    case 'absorption': return 'Event horizon crossed — body in transit'
    case 'reset': return 'Baseline restored — all bodies accounted for'
    default: return 'Orbiting baseline — hover to attract, click to create a black hole'
  }
}

export function SceneOverlay({ mode = 'header', interaction, selectedName, showLabels, showMeasurements, quality = 'balanced', loading = false, reducedMotion = false }: SceneOverlayProps) {
  const blackHoleActive = interaction === 'black-hole' || interaction === 'absorption'
  const announcement = selectedName ? `${selectedName} selected. ${interactionCopy(interaction)}.` : interactionCopy(interaction)

  if (mode === 'header') {
    return (
      <>
        <header className="topbar">
          <a className="brand" href="/" aria-label="Orbitarium home"><span className="brand-mark" aria-hidden="true">◒</span><span>Orbitarium</span></a>
          <div className="topbar-meta"><span className="eyebrow">Interactive field guide / 01</span><span className="status-dot"><span className="status-dot-light" />Local simulation ready</span></div>
        </header>
        <div className="guide-strip" aria-label="Interaction guidance">
          <span className="guide-strip-label">How to explore</span>
          <span>Hover to attract planets</span><span>Click the field to create a black hole</span><span>Click a body for field notes</span>
          <span className={`guide-status ${blackHoleActive ? 'is-hot' : ''}`}><i aria-hidden="true" />{blackHoleActive ? 'Black hole active' : interaction === 'hover-attractor' ? 'Gravity live' : 'Gravity ready'}</span>
        </div>
      </>
    )
  }

  return (
    <div className={`scene-overlay ${reducedMotion ? 'motion-reduced' : ''}`} aria-label="Scene legend">
      <div className="scene-prompt"><span className="prompt-orbit" aria-hidden="true" /><div><strong>Explore the field</strong><span>Hover to attract · click to create a black hole</span></div></div>
      <div className="scene-status-stack">
        <span className={interaction === 'hover-attractor' ? 'is-live' : ''}><i aria-hidden="true" />{interaction === 'hover-attractor' ? 'Hover gravity live' : 'Hover gravity ready'}</span>
        <span className={blackHoleActive ? 'is-danger' : ''}><i aria-hidden="true" />{blackHoleActive ? 'Black hole active' : 'Black hole dormant'}</span>
      </div>
      {showLabels && <div className="orbit-labels" aria-label="Orbit labels are visible"><span>inner worlds</span><span>habitable zone</span><span>outer giants</span></div>}
      {showMeasurements && <div className="measurement-legend"><span className="legend-line" aria-hidden="true" />Distances shown in AU <small>1 AU = Earth–Sun</small></div>}
      {loading && <div className="overlay-loading" role="status"><span className="loading-orbit" /> Loading local star maps…</div>}
      <div className="scene-quality">{quality} render <span aria-hidden="true">·</span> {showLabels ? 'labels on' : 'clean field'}</div>
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
    </div>
  )
}
