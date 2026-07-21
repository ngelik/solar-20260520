import { describe, expect, it } from 'vitest'
import { ShaderPass } from 'three-stdlib'
import { Vector2 } from 'three'
import {
  ABSORPTION_STAGE_DURATIONS,
  BLACK_HOLE_SHADER_LIMITS,
  BLACK_HOLE_UNIFORM_KEYS,
  DISTORTION_CURVE,
  PARTICLE_BUDGETS,
  SHRINK_CURVE,
  LENSING_POST_FRAGMENT_SHADER,
  LENSING_POST_VERTEX_SHADER,
  createBlackHoleUniforms,
  getAbsorptionVisuals,
  getLensingStrength,
  synchronizeBlackHoleUniforms
} from './blackHoleShaders'

describe('black-hole effect configuration', () => {
  it('keeps shader constants bounded and singularity-safe', () => {
    expect(BLACK_HOLE_SHADER_LIMITS.maxLensingStrength).toBeGreaterThan(0)
    expect(BLACK_HOLE_SHADER_LIMITS.maxLensingStrength).toBeLessThanOrEqual(1)
    expect(BLACK_HOLE_SHADER_LIMITS.minLensingRadius).toBeGreaterThan(0)
    expect(BLACK_HOLE_SHADER_LIMITS.maxLensingRadius).toBeLessThanOrEqual(0.5)
    expect(BLACK_HOLE_SHADER_LIMITS.maxSamples).toBeLessThanOrEqual(8)
  })

  it('scales particle budgets by quality without exceeding the cinematic cap', () => {
    expect(PARTICLE_BUDGETS.eco).toBeLessThan(PARTICLE_BUDGETS.balanced)
    expect(PARTICLE_BUDGETS.balanced).toBeLessThan(PARTICLE_BUDGETS.cinematic)
    expect(PARTICLE_BUDGETS.cinematic).toBeLessThanOrEqual(256)
  })

  it('keeps every absorption stage nonzero and visual curves ordered', () => {
    expect(Object.values(ABSORPTION_STAGE_DURATIONS).every((duration) => duration > 0)).toBe(true)
    expect(DISTORTION_CURVE.every((value, index) => index === 0 || value >= DISTORTION_CURVE[index - 1])).toBe(true)
    expect(SHRINK_CURVE.every((value, index) => index === 0 || value <= SHRINK_CURVE[index - 1])).toBe(true)
    expect(getAbsorptionVisuals('fade', 0.5).shrink).toBeGreaterThan(getAbsorptionVisuals('fade', 1).shrink)
    expect(getAbsorptionVisuals('tidal', 1).distortion).toBeLessThan(getAbsorptionVisuals('collapse', 1).distortion)
    expect(getAbsorptionVisuals('collapse', 1).distortion).toBeLessThan(getAbsorptionVisuals('fade', 1).distortion)
  })

  it('defines reusable resolution-aware shader uniforms', () => {
    const uniforms = createBlackHoleUniforms(1.25)
    expect(Object.keys(uniforms)).toEqual(BLACK_HOLE_UNIFORM_KEYS)
    expect(uniforms.resolution.value.x).toBeGreaterThan(0)
    expect(uniforms.center.value.toArray()).toEqual([0.5, 0.5])
    expect(uniforms.quality.value).toBeLessThanOrEqual(1)
  })

  it('synchronizes the cloned uniforms on the mounted ShaderPass and clears them on reset', () => {
    const sourceUniforms = createBlackHoleUniforms()
    const mountedPass = new ShaderPass({
      uniforms: sourceUniforms,
      vertexShader: LENSING_POST_VERTEX_SHADER,
      fragmentShader: LENSING_POST_FRAGMENT_SHADER
    })
    const resolution = new Vector2(1440, 900)
    const center = new Vector2(0.62, 0.41)

    expect(mountedPass.uniforms).not.toBe(sourceUniforms)
    synchronizeBlackHoleUniforms(mountedPass.uniforms, { resolution, center, time: 12, strength: getLensingStrength(0.2, 0.4), quality: 1 })
    expect(mountedPass.uniforms.resolution.value.toArray()).toEqual([1440, 900])
    expect(mountedPass.uniforms.center.value.toArray()).toEqual([0.62, 0.41])
    expect(mountedPass.uniforms.time.value).toBe(12)
    expect(mountedPass.uniforms.strength.value).toBe(0.4)
    expect(mountedPass.uniforms.quality.value).toBe(1)

    synchronizeBlackHoleUniforms(mountedPass.uniforms, { resolution, center, time: 13, strength: getLensingStrength(0.2, 0.8), quality: 0.7 })
    expect(mountedPass.uniforms.strength.value).toBeGreaterThan(0.4)
    expect(mountedPass.uniforms.time.value).toBe(13)

    synchronizeBlackHoleUniforms(mountedPass.uniforms, { resolution, center, time: 14, strength: 0, quality: 0.7 })
    expect(mountedPass.uniforms.strength.value).toBe(0)
    mountedPass.dispose()
  })
})
