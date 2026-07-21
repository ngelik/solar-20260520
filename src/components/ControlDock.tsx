import type { ChangeEvent } from 'react'
import type { QualityPreset } from '../state/solarStore'

const SPEEDS = [0.25, 0.5, 1, 2, 4] as const

interface ControlDockProps {
  readonly paused: boolean
  readonly speed: number
  readonly quality: QualityPreset
  readonly showFacts: boolean
  readonly showMeasurements: boolean
  readonly disabled?: boolean
  readonly onPausedChange: (paused: boolean) => void
  readonly onSpeedChange: (speed: number) => void
  readonly onQualityChange: (quality: QualityPreset) => void
  readonly onFactsChange: (visible: boolean) => void
  readonly onMeasurementsChange: (visible: boolean) => void
  readonly onCameraReset: () => void
  readonly onFullReset: () => void
}

export function ControlDock({
  paused,
  speed,
  quality,
  showFacts,
  showMeasurements,
  disabled = false,
  onPausedChange,
  onSpeedChange,
  onQualityChange,
  onFactsChange,
  onMeasurementsChange,
  onCameraReset,
  onFullReset
}: ControlDockProps) {
  const handleSpeedChange = (event: ChangeEvent<HTMLSelectElement>) => onSpeedChange(Number(event.target.value))
  const handleQualityChange = (event: ChangeEvent<HTMLSelectElement>) => onQualityChange(event.target.value as QualityPreset)

  return (
    <section className="control-dock" aria-labelledby="control-dock-title">
      <div className="dock-heading">
        <div>
          <p className="eyebrow accent">Mission controls</p>
          <h2 id="control-dock-title">Tune the field</h2>
        </div>
        <span className="dock-key">Tab / Enter</span>
      </div>
      <div className="dock-controls">
        <button type="button" className={`dock-button primary ${paused ? 'is-active' : ''}`} onClick={() => onPausedChange(!paused)} aria-pressed={paused} disabled={disabled}>
          <span className="button-icon" aria-hidden="true">{paused ? '▶' : 'Ⅱ'}</span>
          {paused ? 'Resume orbit' : 'Pause orbit'}
        </button>
        <label className="dock-field">
          <span>Simulation speed</span>
          <select value={speed} onChange={handleSpeedChange} disabled={disabled} aria-label="Simulation speed">
            {SPEEDS.map((option) => <option key={option} value={option}>{option}×</option>)}
          </select>
        </label>
        <label className="dock-field">
          <span>Render quality</span>
          <select value={quality} onChange={handleQualityChange} disabled={disabled} aria-label="Render quality">
            <option value="eco">Eco</option>
            <option value="balanced">Balanced</option>
            <option value="cinematic">Cinematic</option>
          </select>
        </label>
        <button type="button" className={`dock-button ${showFacts ? 'is-active' : ''}`} onClick={() => onFactsChange(!showFacts)} aria-pressed={showFacts} disabled={disabled}>
          <span className="button-icon" aria-hidden="true">✦</span>
          {showFacts ? 'Hide facts' : 'Show facts'}
        </button>
        <button type="button" className={`dock-button ${showMeasurements ? 'is-active' : ''}`} onClick={() => onMeasurementsChange(!showMeasurements)} aria-pressed={showMeasurements} disabled={disabled}>
          <span className="button-icon" aria-hidden="true">⌁</span>
          {showMeasurements ? 'Hide measurements' : 'Show measurements'}
        </button>
        <button type="button" className="dock-button quiet-button" onClick={onCameraReset} disabled={disabled}>Reset camera</button>
        <button type="button" className="dock-button danger-button" onClick={onFullReset} disabled={disabled}>Reset whole scene</button>
      </div>
    </section>
  )
}
