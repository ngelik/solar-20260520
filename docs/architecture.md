# Frontend architecture

## Module boundaries

`src/App.tsx` owns composition and UI state wiring. `components/` contains the catalog, facts panel, overlays, and control dock. `state/solarStore.ts` is the small Zustand boundary for user intent and reset tokens. `simulation/engine.ts` owns mutable body state and deterministic progression. `rendering/SolarScene.tsx` owns the R3F scene graph, texture readiness, camera controls, and the frame loop. `effects/` contains the black-hole shaders and postprocessing, while `interactions/` projects real pointer input into the orbital plane. `domain/` is the educational body catalog, and `rendering/debugBridge.ts` exposes read-only diagnostics for browser evidence.

## Data flow and frame loop

React actions update the store. The renderer reads the store for selection, quality, and camera-reset tokens, while the simulation engine remains a stable mutable object so frame updates do not allocate a new state tree. Every R3F frame advances the engine, interpolates meshes toward body state, updates shader uniforms, and publishes a throttled diagnostic snapshot. UI overlays subscribe to store state; they do not reach into Three.js objects.

The debug bridge publishes `sceneReady`, renderer name, encoded texture dimensions, simulation time, body positions, frame count, quality tier, interaction state, absorption stage, and the last scene error on `window.__orbitariumDiagnostics`. Browser readiness requires the scene semantic flag, all ten texture entries, and more than the minimum simulation progress; timeout messages include the complete last snapshot. It is intentionally read-only from the browser test's perspective.

## R3F escape hatches

The scene uses declarative R3F objects for planets, orbit paths, lights, and controls. Imperative refs are used where a frame loop must mutate an existing Three.js object: mesh lerping, axial rotation, Saturn's rings, particle buffers, shader uniforms, and camera reset. `useMemo` holds vectors, maps, particle geometry, materials, and shader uniforms across frames. The `SceneBoundary` and Canvas fallback keep a failed WebGL context visible as an explicit state.

## Rendering and color

Bundled texture metadata is the source of truth for paths, dimensions, and color intent. Planet and ring maps are assigned sRGB color space; shader values and lighting remain linear. Meshes use PBR-style `MeshStandardMaterial` with roughness tuned by body, low metalness, an ambient fill, and a warm point light. The Sun uses an unlit material so its map stays emissive-looking. This separation prevents albedo textures from being treated as light intensity.

## Quality and performance

Eco, balanced, and cinematic scale star count, particle budget, postprocess multisampling, and ambient-light strength. Device pixel ratio is capped, anisotropy is capped at four, and geometry/material instances are created once per quality selection. The frame loop avoids per-frame allocations by reusing vectors and mutating typed particle buffers. Diagnostics publish at a quarter-second cadence instead of every render frame. Keep new frame work allocation-free, add quality scaling for expensive effects, and keep educational data out of the render loop.

When changing the scene, verify both software and hardware-rendered Chromium where available. Preserve the semantic readiness signal and update browser evidence if selectors, interaction states, or screenshot composition change.
