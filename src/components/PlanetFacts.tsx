import type { BodyDefinition } from '../domain/bodies'

interface PlanetFactsProps {
  readonly body: BodyDefinition | null
  readonly isConsumed?: boolean
}

function formatMass(massKg: number): string {
  return massKg === 0 ? '0 kg' : `${massKg.toExponential(2)} kg`
}

function formatDistance(distanceAu: number): string {
  if (distanceAu === 0) return 'System center'
  return `${distanceAu.toFixed(distanceAu < 10 ? 2 : 1)} AU · ${(distanceAu * 149_597_870.7).toLocaleString('en-US', { maximumFractionDigits: 0 })} km`
}

export function PlanetFacts({ body, isConsumed = false }: PlanetFactsProps) {
  if (!body) {
    return (
      <aside className="facts-panel facts-empty" aria-labelledby="facts-title">
        <p className="eyebrow accent">Selected body</p>
        <h2 id="facts-title">Choose a world</h2>
        <p>Select a body in the catalog or click a planet in the scene to open its field notes.</p>
        <div className="facts-empty-orbit" aria-hidden="true"><span /></div>
      </aside>
    )
  }

  return (
    <aside className={`facts-panel ${isConsumed ? 'is-consumed' : ''}`} aria-labelledby="facts-title">
      <div className="facts-kicker">
        <span className={`catalog-swatch swatch-${body.id}`} aria-hidden="true" />
        <span className="eyebrow accent">Field note / {body.kind}</span>
      </div>
      <div className="facts-title-row">
        <div>
          <h2 id="facts-title">{body.name}</h2>
          <p className="facts-subtitle">{isConsumed ? 'Temporarily beyond the event horizon' : 'Selected for exploration'}</p>
        </div>
        <span className="facts-index">{body.id === 'sun' ? '★' : body.id.slice(0, 2).toUpperCase()}</span>
      </div>
      <ul className="fact-list">
        {body.facts.map((fact) => <li key={fact}><span aria-hidden="true">+</span>{fact}</li>)}
      </ul>
      <dl className="measure-grid">
        <div><dt>Distance from Sun</dt><dd>{formatDistance(body.distanceAu)}</dd></div>
        <div><dt>Mass</dt><dd>{formatMass(body.massKg)}</dd></div>
        <div><dt>Radius</dt><dd>{body.radiusKm.toLocaleString('en-US')} km</dd></div>
        <div><dt>Orbital speed</dt><dd>{body.orbitalSpeedKmPerSecond ? `${body.orbitalSpeedKmPerSecond.toFixed(2)} km/s` : '—'}</dd></div>
        <div><dt>Orbital period</dt><dd>{body.orbitalPeriodDays ? `${body.orbitalPeriodDays.toLocaleString('en-US', { maximumFractionDigits: 2 })} days` : '—'}</dd></div>
      </dl>
      <p className="facts-caveat"><strong>Read the scale.</strong> Scene scale and destructive gravity are stylized so the system stays legible and playful. {body.caveat}</p>
    </aside>
  )
}
