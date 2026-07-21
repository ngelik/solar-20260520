# Orbitarium asset ledger

The local planet maps are optimized, equirectangular derivatives prepared for
this browser-only preview. The source collection is **Solar Textures** by
Solar System Scope / INOVE:

- Origin: https://genesis-horizon.solarsystemscope.com/textures/
- Creator / agency: Solar System Scope (INOVE)
- Source basis: NASA elevation and imagery data, tuned against Messenger,
  Viking, Cassini, Hubble, and NASA Blue Marble imagery as described by the
  publisher.
- License: Creative Commons Attribution 4.0 International
  (https://creativecommons.org/licenses/by/4.0/)
- Access context: public texture collection accessed 2026-07-20 for offline
  educational rendering.
- Source dimensions: 8K maps are 8192 × 4096; Uranus and Neptune are 2048 ×
  1024; the Saturn ring source is 8192 × 2048. The local derivatives are
  encoded at 2048 px wide (the ring map at 2048 × 512).
- Transformations: normalized equirectangular orientation, downsampled to
  2048 px wide, re-encoded as WebP, assigned sRGB intent, embedded with the
  sRGB ICC profile, and (for the ring map) retained with an alpha channel. No
  remote requests are made at runtime.

The app's `public/textures/manifest.json` records the body assignment,
dimensions, color-space intent, and encoded byte sizes for each bundled file.
