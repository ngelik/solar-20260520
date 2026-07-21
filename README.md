# Orbitarium

Orbitarium is a browser-only, interactive field guide to the Solar System. It uses a local React, React Three Fiber, and Three.js scene with bundled WebP textures; no account, API, or runtime third-party request is required.

## Prerequisites and setup

- Node.js 20 or newer and npm.
- A Chromium installation for browser verification. Run `npx playwright install chromium` once if the bundled browser is not present.

Install dependencies with:

```bash
npm install
```

Start the development server with `npm run dev`. For the production path, run `npx vite build`, then `npx vite preview --host 127.0.0.1 --port 4173` and open http://127.0.0.1:4173/. The browser suite uses that production preview, so it exercises the same built assets an operator will serve.

## Explore the scene

Hover the field to apply the nominal cursor attractor. A short primary click on empty space creates the stylized black hole and its staged absorption event. Click a catalog item or a visible planet for field notes.

The control dock provides pause/resume, simulation speed (0.25×–4×), render quality, facts, distance measurements, camera reset, and full-scene reset. The footer toggles orbit labels. The controls are keyboard reachable; Tab moves between controls and Enter activates a focused button.

The educational overlays explain inner worlds, the habitable zone, outer giants, AU measurements, and each body's distance, mass, radius, orbital speed, and period. Values are reference facts while the scene scale is intentionally compressed.

## Verification

```bash
npx vite build
npx vitest run
npx eslint .
npx tsc -b
npx playwright test
```

For delivery evidence, run the two viewport projects in order, then the full suite:

```bash
npx playwright test tests/e2e/solar-system.spec.ts --project=desktop-1280
npx playwright test tests/e2e/solar-system.spec.ts --project=desktop-1920
npx playwright test
```

The browser suite starts a production preview, registers request capture before navigation, checks local requests, semantic and diagnostic readiness, nonblank WebGL pixels, orbital motion, cursor gravity, black-hole pixels, absorption ordering, reset behavior, controls, keyboard access, and desktop layout at 1280×720 and 1920×1080. Each successful project writes its initial and black-hole evidence only after its readiness gates. The renderer string is attached to the Playwright result; traces and screenshots are retained on failure in `/private/tmp/orbitarium-playwright-results`.

Committed browser evidence is in `artifacts/screenshots/`:

- `solar-1280-initial.png` and `solar-1280-black-hole.png`
- `solar-1920-initial.png` and `solar-1920-black-hole.png`

The browser test records renderer diagnostics and keeps traces on failure in `/private/tmp/orbitarium-playwright-results`. Pixel assertions are tolerant metrics (coverage, variance, regional change, and frame difference), not exact snapshots.

## Offline assets and attribution

All essential application files and imagery are served from this repository. The texture provenance, transformations, dimensions, and license are recorded in [`public/assets/ATTRIBUTION.md`](public/assets/ATTRIBUTION.md). The source collection is [Solar Textures by Solar System Scope / INOVE](https://genesis-horizon.solarsystemscope.com/textures/) under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Runtime requests are expected to stay on the local preview origin.

## Known limitations

This is an educational visualization, not an ephemeris or physics solver. WebGL availability, shader precision, texture filtering, postprocessing support, and frame rate depend on the browser and GPU. Chromium may use hardware acceleration or SwiftShader, so the suite records the renderer and deliberately avoids exact-pixel comparisons. If WebGL cannot create a context, enable hardware acceleration or use a browser with WebGL support. Reduced-motion settings shorten UI transitions but do not remove the simulation frame loop used for diagnostics.
