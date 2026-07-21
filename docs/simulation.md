# Simulation model and limitations

The simulation is a deliberately readable teaching model. Body radius, orbital distance, and time are separate scales: presentation radii are hand-tuned, distances use `0.95 + log1p(distanceAu) * 1.33`, and one Earth year is represented by 90 simulation seconds. Bodies begin on deterministic circular baselines derived from a seed. Their angular velocities use their catalog orbital periods, with a small bounded presentation jitter so a moving system remains visually legible. Frame deltas are capped before integration, which keeps a paused tab or a slow software renderer from producing a single enormous step.

## Cursor gravity

Hovering projects the real pointer onto the y=0 orbital plane and enables a nominal ten-Jupiter cursor attractor. The force uses a softening length of 0.72 scene units, a presentation amplification of 3.2, and capped acceleration and velocity. Those caps are intentional: the effect should be visible without teleporting a body or destabilizing the frame loop. The black hole reuses the same source position and raises its effective mass as its level grows.

## State transitions

The normal interaction is `inactive`, `hover-attractor`, or `paused`. A primary click on empty canvas space enters `black-hole`; bodies inside the growing capture radius enter `absorption`. Each captured body progresses in order through `tidal` (0.7 s), `collapse` (0.75 s), `fade` (0.9 s), and `consumed`. The body is elongated and slightly shrunk during tidal motion, collapses toward the source, fades to zero, and is then marked inactive. Full reset restores the deterministic initial body states, speed, pause state, hover/black-hole flags, and UI overlays. Camera reset only increments a camera token and leaves simulation state intact.

## Visual event

The black-hole effect is a screen-space teaching aid: a dark event-horizon shell, additive accretion ring, moving particles, and a lensing postpass are synchronized to the simulation level and absorption distortion. It is not a general-relativistic ray tracer. The postpass bends nearby screen pixels around the projected source; it does not alter the underlying orbital integration.

## Scientific limitations

The model does not integrate N-body gravity, eccentricity, inclination, barycentric motion, relativistic effects, moons, atmospheres, weather, or a real-time ephemeris. Orbit radii, body sizes, timing, cursor mass, and black-hole capture are presentation choices. Catalog facts retain reference units, but the rendered scene is compressed and amplified for comparison and interaction. Use the overlays and [`public/assets/ATTRIBUTION.md`](../public/assets/ATTRIBUTION.md) as the educational context, not as a precision astronomy instrument.
