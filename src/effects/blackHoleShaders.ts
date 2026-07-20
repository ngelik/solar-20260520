import { Vector2, type IUniform } from 'three'

export const BLACK_HOLE_SHADER_LIMITS = Object.freeze({
  maxLensingStrength: 0.88,
  minLensingRadius: 0.045,
  maxLensingRadius: 0.42,
  maxSamples: 7
})

export const BLACK_HOLE_UNIFORM_KEYS = Object.freeze(['resolution', 'center', 'time', 'strength', 'quality', 'tDiffuse'] as const)

export const ACCRETION_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying float vRadius;
  void main() {
    vUv = uv;
    vRadius = length(position.xy);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

export const ACCRETION_FRAGMENT_SHADER = /* glsl */ `
  uniform float time;
  uniform float strength;
  uniform float quality;
  varying vec2 vUv;
  varying float vRadius;
  void main() {
    vec2 centered = vUv - 0.5;
    float radial = 1.0 - smoothstep(0.025, 0.2, abs(vRadius - 0.79));
    float swirl = 0.5 + 0.5 * sin(time * (1.8 + quality) + atan(centered.y, centered.x) * 6.0 - vRadius * 15.0);
    float hotBand = smoothstep(0.2, 0.88, swirl) * radial;
    vec3 color = mix(vec3(0.95, 0.16, 0.035), vec3(1.0, 0.72, 0.24), hotBand);
    gl_FragColor = vec4(color, radial * (0.2 + strength * 0.72));
  }
`

export const LENSING_VERTEX_SHADER = /* glsl */ `
  varying vec3 vNormal;
  varying vec2 vUv;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

export const LENSING_FRAGMENT_SHADER = /* glsl */ `
  uniform vec2 resolution;
  uniform vec2 center;
  uniform float time;
  uniform float strength;
  uniform float quality;
  varying vec3 vNormal;
  varying vec2 vUv;
  void main() {
    vec2 safeResolution = max(resolution, vec2(1.0));
    vec2 screen = (gl_FragCoord.xy / safeResolution) - center;
    float radius = max(length(screen), 0.045);
    float bounded = clamp(strength, 0.0, 0.88);
    float ring = (1.0 - smoothstep(0.08, 0.42, radius)) * (0.35 + 0.65 * quality);
    float shimmer = 0.75 + 0.25 * sin(time * 2.0 + vUv.x * 12.0);
    vec3 edge = vec3(0.95, 0.18, 0.035) * ring * shimmer;
    gl_FragColor = vec4(edge, ring * bounded * (0.28 + 0.14 * abs(vNormal.z)));
  }
`

export const LENSING_POST_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

export const LENSING_POST_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 resolution;
  uniform vec2 center;
  uniform float time;
  uniform float strength;
  uniform float quality;
  varying vec2 vUv;
  void main() {
    vec2 safeResolution = max(resolution, vec2(1.0));
    vec2 delta = vUv - center;
    float radius = max(length(delta * safeResolution / min(safeResolution.x, safeResolution.y)), 0.04);
    float falloff = smoothstep(0.48, 0.04, radius);
    float boundedStrength = clamp(strength, 0.0, 0.88) * (0.55 + quality * 0.45);
    vec2 direction = delta / radius;
    vec2 offset = direction * falloff * boundedStrength * 0.018;
    vec2 uv = clamp(vUv + offset + direction * sin(time * 1.6) * falloff * boundedStrength * 0.002, vec2(0.001), vec2(0.999));
    gl_FragColor = texture2D(tDiffuse, uv);
  }
`

export interface BlackHoleUniforms {
  readonly [uniform: string]: IUniform<unknown>
  readonly resolution: IUniform<Vector2>
  readonly center: IUniform<Vector2>
  readonly time: IUniform<number>
  readonly strength: IUniform<number>
  readonly quality: IUniform<number>
  readonly tDiffuse: IUniform<null>
}

export interface BlackHoleUniformValues {
  readonly resolution: Vector2
  readonly center: Vector2
  readonly time: number
  readonly strength: number
  readonly quality: number
}

/** Updates the live uniform map, including maps cloned by ShaderPass. */
export function synchronizeBlackHoleUniforms(uniforms: Record<string, IUniform<unknown>>, values: BlackHoleUniformValues): void {
  const resolution = uniforms.resolution?.value as Vector2 | undefined
  const center = uniforms.center?.value as Vector2 | undefined
  if (resolution instanceof Vector2) resolution.copy(values.resolution)
  else if (uniforms.resolution) uniforms.resolution.value = values.resolution.clone()
  if (center instanceof Vector2) center.copy(values.center)
  else if (uniforms.center) uniforms.center.value = values.center.clone()
  if (uniforms.time) uniforms.time.value = values.time
  if (uniforms.strength) uniforms.strength.value = clampLensingStrength(values.strength)
  if (uniforms.quality) uniforms.quality.value = Math.min(1, Math.max(0.5, values.quality))
}

export function createBlackHoleUniforms(quality = 1): BlackHoleUniforms {
  return {
    resolution: { value: new Vector2(1, 1) },
    center: { value: new Vector2(0.5, 0.5) },
    time: { value: 0 },
    strength: { value: 0 },
    quality: { value: Math.min(1, Math.max(0.5, quality)) },
    tDiffuse: { value: null }
  }
}

export const ABSORPTION_STAGE_DURATIONS = Object.freeze({ tidal: 0.7, collapse: 0.75, fade: 0.9 })
export const PARTICLE_BUDGETS = Object.freeze({ eco: 72, balanced: 144, cinematic: 240 })
export const DISTORTION_CURVE = Object.freeze([0.08, 0.3, 0.72, 1])
export const SHRINK_CURVE = Object.freeze([1, 0.9, 0.35, 0])

export function clampLensingStrength(value: number): number {
  return Math.min(BLACK_HOLE_SHADER_LIMITS.maxLensingStrength, Math.max(0, value))
}

export function getLensingStrength(interactionStrength: number, absorptionDistortion = 0): number {
  return clampLensingStrength(Math.max(interactionStrength, absorptionDistortion))
}

export function getAbsorptionVisuals(stage: 'none' | 'tidal' | 'collapse' | 'fade' | 'consumed', progress: number) {
  const t = Math.min(1, Math.max(0, progress))
  if (stage === 'tidal') return { elongation: 1 + t * 1.8, shrink: 1 - t * 0.1, fade: 1, distortion: t * 0.3 }
  if (stage === 'collapse') return { elongation: 2.8 - t * 1.2, shrink: 0.9 - t * 0.55, fade: 1, distortion: 0.3 + t * 0.5 }
  if (stage === 'fade') return { elongation: 1.6, shrink: 0.35 - t * 0.35, fade: 1 - t, distortion: 0.8 + t * 0.2 }
  if (stage === 'consumed') return { elongation: 1, shrink: 0, fade: 0, distortion: 1 }
  return { elongation: 1, shrink: 1, fade: 1, distortion: 0 }
}
