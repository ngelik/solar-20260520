import { useMemo, useRef } from 'react'
import { Effects } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import type { ShaderPass as ShaderPassImpl } from 'three-stdlib'
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Group, Mesh, Points, PointsMaterial, ShaderMaterial, Vector2, Vector3 } from 'three'
import { getSolarFrame } from '../state/solarStore'
import { pointerGravityPosition } from '../interactions/PointerGravity'
import { QUALITY_TIERS } from '../rendering/textureCatalog'
import {
  ACCRETION_FRAGMENT_SHADER,
  ACCRETION_VERTEX_SHADER,
  createBlackHoleUniforms,
  LENSING_FRAGMENT_SHADER,
  LENSING_VERTEX_SHADER,
  LENSING_POST_FRAGMENT_SHADER,
  LENSING_POST_VERTEX_SHADER,
  PARTICLE_BUDGETS,
  getLensingStrength,
  synchronizeBlackHoleUniforms
} from './blackHoleShaders'

type QualityPreset = keyof typeof QUALITY_TIERS

function createParticleGeometry(count: number) {
  const positions = new Float32Array(count * 3)
  const seeds = new Float32Array(count * 4)
  for (let index = 0; index < count; index += 1) {
    const angle = index * 2.399963 + 0.4
    const radius = 0.28 + (index % 31) / 31 * 1.1
    const offset = index * 3
    positions[offset] = Math.cos(angle) * radius
    positions[offset + 1] = ((index % 17) / 17 - 0.5) * 0.16
    positions[offset + 2] = Math.sin(angle) * radius
    const seedOffset = index * 4
    seeds[seedOffset] = angle
    seeds[seedOffset + 1] = radius
    seeds[seedOffset + 2] = (index % 19) / 19
    seeds[seedOffset + 3] = 0.75 + (index % 23) / 23
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  return { geometry, seeds }
}

function qualityValue(quality: QualityPreset): number {
  return QUALITY_TIERS[quality]
}

export function BlackHole({ quality }: { quality: QualityPreset }) {
  const { camera, size, viewport } = useThree()
  const simulation = getSolarFrame()
  const group = useRef<Group>(null)
  const disk = useRef<Mesh>(null)
  const shell = useRef<Mesh>(null)
  const particles = useRef<Points>(null)
  const diskMaterial = useRef<ShaderMaterial>(null)
  const shellMaterial = useRef<ShaderMaterial>(null)
  const postPass = useRef<ShaderPassImpl>(null)
  const source = useMemo(() => new Vector3(), [])
  const projected = useMemo(() => new Vector3(), [])
  const resolution = useMemo(() => new Vector2(1, 1), [])
  const center = useMemo(() => new Vector2(0.5, 0.5), [])
  const uniforms = useMemo(() => createBlackHoleUniforms(qualityValue(quality)), [quality])
  const postShader = useMemo(() => ({ uniforms, vertexShader: LENSING_POST_VERTEX_SHADER, fragmentShader: LENSING_POST_FRAGMENT_SHADER }), [uniforms])
  const particleData = useMemo(() => createParticleGeometry(PARTICLE_BUDGETS[quality]), [quality])
  const particleMaterial = useMemo(() => new PointsMaterial({ color: new Color('#f6a55f'), size: quality === 'eco' ? 0.035 : 0.045, transparent: true, depthWrite: false, blending: AdditiveBlending, opacity: 0.72 }), [quality])

  useFrame(({ clock }) => {
    if (!group.current) return
    const active = simulation.isBlackHoleActive
    group.current.visible = active
    const level = active ? simulation.blackHoleEscalation : 0
    const absorptionDistortion = simulation.bodies.reduce((maximum, body) => Math.max(maximum, body.lensingIntensity), 0)
    const time = clock.elapsedTime
    if (active) {
      source.copy(pointerGravityPosition)
      group.current.position.lerp(source, 0.2)
    }
    projected.copy(group.current.position).project(camera)
    resolution.set(Math.max(1, size.width * viewport.dpr), Math.max(1, size.height * viewport.dpr))
    const centerY = projected.y * 0.5 + 0.5
    const centerX = projected.x * 0.5 + 0.5
    const strength = active ? getLensingStrength(level, absorptionDistortion) : 0
    center.set(centerX, centerY)
    const uniformValues = { resolution, center, time, strength, quality: qualityValue(quality) }
    synchronizeBlackHoleUniforms(uniforms, uniformValues)
    if (postPass.current) synchronizeBlackHoleUniforms(postPass.current.uniforms, uniformValues)
    if (!active) return

    if (disk.current) disk.current.rotation.z = time * 0.3 + level * 2.1
    if (shell.current) shell.current.scale.setScalar(0.82 + level * 0.16)

    const positionAttribute = particles.current?.geometry.getAttribute('position') as BufferAttribute | undefined
    if (positionAttribute) {
      const positions = positionAttribute.array as Float32Array
      let shedding = 0
      for (const body of simulation.bodies) if (body.absorptionStage !== 'none') shedding = Math.max(shedding, body.lensingIntensity)
      for (let index = 0; index < particleData.seeds.length / 4; index += 1) {
        const seedOffset = index * 4
        const progress = (time * 0.09 * particleData.seeds[seedOffset + 3] + particleData.seeds[seedOffset + 2]) % 1
        const radius = particleData.seeds[seedOffset + 1] * (1 - progress * 0.28) + shedding * progress * 0.45
        const angle = particleData.seeds[seedOffset] + time * (0.55 + level) + progress * 1.9
        const offset = index * 3
        positions[offset] = Math.cos(angle) * radius
        positions[offset + 1] = Math.sin(angle * 1.7) * 0.06 + (progress - 0.5) * shedding * 0.2
        positions[offset + 2] = Math.sin(angle) * radius
      }
      positionAttribute.needsUpdate = true
      particleMaterial.opacity = 0.42 + level * 0.34 + shedding * 0.18
    }
  })

  return <>
    <group ref={group} visible={false}>
      <pointLight color="#ff6336" intensity={4.5} distance={5.5} decay={2} />
      <mesh ref={shell} scale={0.82}>
        <sphereGeometry args={[0.58, 32, 20]} />
        <shaderMaterial ref={shellMaterial} uniforms={uniforms} vertexShader={LENSING_VERTEX_SHADER} fragmentShader={LENSING_FRAGMENT_SHADER} transparent depthWrite={false} blending={AdditiveBlending} side={2} />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.34, 48, 32]} />
        <meshBasicMaterial color="#010107" />
      </mesh>
      <mesh ref={disk} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.4, 1.18, 96]} />
        <shaderMaterial ref={diskMaterial} uniforms={uniforms} vertexShader={ACCRETION_VERTEX_SHADER} fragmentShader={ACCRETION_FRAGMENT_SHADER} transparent depthWrite={false} blending={AdditiveBlending} />
      </mesh>
      <points ref={particles} geometry={particleData.geometry} material={particleMaterial} frustumCulled={false} />
    </group>
    <Effects disableGamma multisamping={quality === 'cinematic' ? 4 : 0}>
      <shaderPass ref={postPass} args={[postShader]} />
    </Effects>
  </>
}
