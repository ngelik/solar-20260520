import { Component, Suspense, useEffect, useMemo, useRef, type PropsWithChildren } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Stars, Html, useTexture } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Texture, Vector3 } from 'three'
import { BODY_CATALOG, type BodyDefinition, type BodyId } from '../domain/bodies'
import { getSolarFrame, useSolarStore } from '../state/solarStore'
import { getRenderDiagnostics, installDiagnosticsGetter, publishRenderDiagnostics } from './debugBridge'
import { configureTexture, MAX_ANISOTROPY, MAX_DPR, QUALITY_TIERS, TEXTURE_CATALOG } from './textureCatalog'
import { BlackHole } from '../effects/BlackHole'
import { markPlanetPointerGesture, PointerGravity, pointerGravityPosition } from '../interactions/PointerGravity'

export const DIAGNOSTICS_INTERVAL_SECONDS = 0.25
const FULL_TURN_RADIANS = Math.PI * 2

export function calculateAxialRotationRadians(deltaSeconds: number, axialRotationHours: number): number {
  return (deltaSeconds * FULL_TURN_RADIANS * 24) / axialRotationHours
}

export function createDiagnosticsPublicationGate(intervalSeconds = DIAGNOSTICS_INTERVAL_SECONDS) {
  let lastPublishedAt = Number.NEGATIVE_INFINITY
  return (timestampSeconds: number) => {
    if (timestampSeconds - lastPublishedAt < intervalSeconds) return false
    lastPublishedAt = timestampSeconds
    return true
  }
}

function LoadingState() {
  return <Html center><div className="canvas-loading" role="status" aria-live="polite"><span className="loading-orbit" /> Loading local star maps…</div></Html>
}

function OrbitPath({ radius, opacity }: { radius: number; opacity: number }) {
  const points = useMemo(() => {
    const vertices: number[] = []
    for (let index = 0; index <= 96; index += 1) {
      const angle = (index / 96) * Math.PI * 2
      vertices.push(Math.cos(angle) * radius, 0, Math.sin(angle) * radius)
    }
    return new Float32Array(vertices)
  }, [radius])
  return <lineLoop frustumCulled={false}><bufferGeometry><bufferAttribute attach="attributes-position" args={[points, 3]} /></bufferGeometry><lineBasicMaterial color="#8da1c3" transparent opacity={opacity} /></lineLoop>
}

function Sun({ texture }: { texture: Texture | null }) {
  const sun = useRef<Mesh>(null)
  const material = useRef<MeshBasicMaterial>(null)
  useFrame((_, delta) => {
    if (sun.current) sun.current.rotation.y = (sun.current.rotation.y + calculateAxialRotationRadians(delta, BODY_CATALOG[0].axialRotationHours)) % FULL_TURN_RADIANS
    if (material.current) material.current.opacity = 0.88 + Math.sin(_.clock.elapsedTime * 1.7) * 0.05
  })
  return <mesh ref={sun} castShadow receiveShadow><sphereGeometry args={[0.7, 48, 32]} /><meshBasicMaterial ref={material} map={texture ?? undefined} color="#ffd18a" toneMapped={false} transparent /></mesh>
}

function Planet({ body, texture, selected, onSelect }: { body: BodyDefinition; texture: Texture | null; selected: boolean; onSelect: (id: BodyId) => void }) {
  const mesh = useRef<Mesh>(null)
  const simulation = getSolarFrame()
  const state = simulation.getBodyState(body.id)
  const radius = body.presentationRadius * body.presentationScale
  const target = useMemo(() => new Vector3(), [])
  const source = useMemo(() => new Vector3(), [])
  useFrame((_, delta) => {
    const current = simulation.getBodyState(body.id)
    if (!mesh.current) return
    target.set(current.x, current.y, current.z)
    mesh.current.position.lerp(target, 1 - Math.pow(0.0001, delta))
    source.copy(pointerGravityPosition)
    const fadeScale = current.shrink * (0.98 + current.tidalElongation * 0.02)
    const stretch = 1 + Math.max(0, current.tidalElongation - 1) * 0.38
    const angleToSource = Math.atan2(source.x - current.x, source.z - current.z)
    mesh.current.rotation.set(0, current.absorptionStage === 'none' ? current.rotation : angleToSource, current.absorptionStage === 'none' ? 0 : current.rotation * 0.1)
    mesh.current.scale.set(fadeScale, fadeScale, fadeScale * stretch)
    const material = mesh.current.material
    if (!Array.isArray(material) && 'opacity' in material) (material as MeshBasicMaterial).opacity = current.fade
  })
  return <mesh ref={mesh} position={[state.x, state.y, state.z]} castShadow receiveShadow onPointerDown={(event) => { event.stopPropagation(); const pointerEvent = event.nativeEvent; if (pointerEvent.button === 0 && pointerEvent.isPrimary !== false) markPlanetPointerGesture(pointerEvent.pointerId); onSelect(body.id) }} onPointerOver={() => { document.body.style.cursor = 'crosshair' }} onPointerOut={() => { document.body.style.cursor = '' }}>
    <sphereGeometry args={[radius, body.id === 'jupiter' || body.id === 'saturn' ? 48 : 32, 24]} />
    <meshStandardMaterial map={texture ?? undefined} color={selected ? '#fff0be' : '#ffffff'} roughness={body.id === 'earth' ? 0.48 : body.id === 'jupiter' || body.id === 'saturn' ? 0.78 : 0.9} metalness={0.02} transparent />
  </mesh>
}

function SaturnRings({ texture }: { texture: Texture | null }) {
  const group = useRef<Group>(null)
  const material = useRef<MeshStandardMaterial>(null)
  const target = useMemo(() => new Vector3(), [])
  const simulation = getSolarFrame()
  useFrame((_, delta) => {
    const state = simulation.getBodyState('saturn')
    if (!group.current) return
    target.set(state.x, state.y, state.z)
    group.current.position.lerp(target, 1 - Math.pow(0.0001, delta))
    group.current.rotation.y = state.rotation
    group.current.scale.setScalar(state.shrink)
    if (material.current) material.current.opacity = 0.82 * state.fade
  })
  return <group ref={group} rotation={[Math.PI / 2.55, 0, 0]}><mesh receiveShadow><ringGeometry args={[0.48, 0.84, 96]} /><meshStandardMaterial ref={material} map={texture ?? undefined} color="#d7c39a" transparent opacity={0.82} side={DoubleSide} alphaTest={0.2} roughness={0.78} /></mesh></group>
}

function SceneContent({ selectedBodyId, quality }: { selectedBodyId: BodyId | null; quality: keyof typeof QUALITY_TIERS }) {
  const textures = useTexture(TEXTURE_CATALOG.map((entry) => entry.path))
  const { gl } = useThree()
  const selected = selectedBodyId
  const simulation = getSolarFrame()
  const camera = useThree((state) => state.camera)
  const controls = useRef<OrbitControlsImpl>(null)
  const resetToken = useSolarStore((state) => state.cameraResetToken)
  const textureMap = useMemo(() => {
    const map = new Map<string, Texture>()
    textures.forEach((texture, index) => {
      const entry = TEXTURE_CATALOG[index]
      configureTexture(texture, entry.colorSpace, Math.min(gl.capabilities.getMaxAnisotropy(), MAX_ANISOTROPY))
      map.set(entry.key, texture)
    })
    return map
  }, [gl, textures])
  const positions = useMemo(() => Object.fromEntries(TEXTURE_CATALOG.map((entry) => [entry.key, entry.encodedDimensions])), [])
  const diagnosticsGate = useRef(createDiagnosticsPublicationGate())
  const renderer = useMemo(() => gl.getContext().getParameter(gl.getContext().RENDERER) as string, [gl])

  useEffect(() => {
    installDiagnosticsGetter()
  }, [])

  useEffect(() => {
    camera.position.set(0, 4.2, 9.6)
    if (controls.current) {
      controls.current.target.set(0, 0, 0)
      controls.current.update()
    }
  }, [camera, resetToken])

  useFrame((_, delta) => {
    simulation.advance(delta)
    if (!diagnosticsGate.current(_.clock.elapsedTime)) return

    const snapshot = simulation.getSnapshot()
    const selectedState = selected ? simulation.getBodyState(selected) : null
    const absorbingState = snapshot.bodies.find((body) => body.absorptionStage !== 'none')
    publishRenderDiagnostics({
      ...getRenderDiagnostics(),
      sceneReady: true,
      renderer,
      textureDimensions: positions,
      simulationTime: snapshot.elapsedSeconds,
      frameCount: getRenderDiagnostics().frameCount + 1,
      qualityTier: quality,
      interactionState: selectedState?.interaction ?? (snapshot.paused ? 'paused' : snapshot.blackHoleLevel > 0 ? 'black-hole' : snapshot.hoverAttractor ? 'hover-attractor' : 'inactive'),
      absorptionState: selectedState?.absorptionStage ?? absorbingState?.absorptionStage ?? 'none',
      bodyPositions: snapshot.bodies.map((body) => ({ id: body.id, x: body.x, y: body.y, z: body.z }))
    })
  })

  const select = (id: BodyId) => {
    window.dispatchEvent(new CustomEvent('orbitarium:select-body', { detail: id }))
  }
  return <>
    <color attach="background" args={['#070b18']} />
    <ambientLight intensity={0.16 * QUALITY_TIERS[quality]} color="#90a9d7" />
    <pointLight position={[0, 0, 0]} intensity={5.4} distance={18} decay={1.3} color="#ffcc8a" castShadow shadow-mapSize={[1024, 1024]} />
    <Stars radius={30} depth={18} count={quality === 'eco' ? 900 : quality === 'balanced' ? 1500 : 2200} factor={1.8} saturation={0.2} fade speed={0.18} />
    <PointerGravity />
    <BlackHole quality={quality} />
    <Sun texture={textureMap.get('sun') ?? null} />
    {BODY_CATALOG.slice(1).map((body, index) => {
      const orbitRadius = 0.95 + Math.log1p(body.distanceAu) * 1.33
      return <group key={body.id}><OrbitPath radius={orbitRadius} opacity={0.08 + index * 0.008} /><Planet body={body} texture={textureMap.get(body.id) ?? null} selected={selected === body.id} onSelect={select} />{body.id === 'saturn' && <SaturnRings texture={textureMap.get('saturn-rings') ?? null} />}</group>
    })}
    <OrbitControls ref={controls} makeDefault enablePan={false} minDistance={3.2} maxDistance={16} dampingFactor={0.08} enableDamping rotateSpeed={0.42} zoomSpeed={0.62} />
  </>
}

class SceneBoundary extends Component<PropsWithChildren, { error: Error | null }> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) return <div className="webgl-fallback" role="alert"><strong>WebGL unavailable</strong><span>Your browser could not start the local 3D view.</span></div>
    return this.props.children
  }
}

export function SolarCanvas({ selectedBodyId, quality }: { selectedBodyId: BodyId | null; quality: keyof typeof QUALITY_TIERS }) {
  return <SceneBoundary><Canvas className="solar-canvas" dpr={[1, MAX_DPR]} camera={{ position: [0, 4.2, 9.6], fov: 46, near: 0.1, far: 60 }} shadows gl={{ antialias: true, powerPreference: 'high-performance' }} fallback={<div className="webgl-fallback" role="alert"><strong>WebGL unavailable</strong><span>Try another browser or enable hardware acceleration.</span></div>}>
    <Suspense fallback={<LoadingState />}><SceneContent selectedBodyId={selectedBodyId} quality={quality} /></Suspense>
  </Canvas></SceneBoundary>
}
