import { Component, Suspense, useEffect, useMemo, useRef, type PropsWithChildren } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Stars, Html } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Texture, Vector3, type Camera, type WebGLRenderer } from 'three'
import { BODY_CATALOG, type BodyDefinition, type BodyId } from '../domain/bodies'
import { getSolarFrame, useSolarStore } from '../state/solarStore'
import { getRenderDiagnostics, installDiagnosticsGetter, publishRenderDiagnostics } from './debugBridge'
import { configureTexture, MAX_ANISOTROPY, MAX_DPR, QUALITY_TIERS, TEXTURE_CATALOG } from './textureCatalog'
import { BlackHole } from '../effects/BlackHole'
import { markPlanetPointerGesture, PointerGravity, pointerGravityPosition } from '../interactions/PointerGravity'

export const DIAGNOSTICS_INTERVAL_SECONDS = 0.25
const FULL_TURN_RADIANS = Math.PI * 2
const MINIMUM_READY_SECONDS = 0.75
const MINIMUM_READY_FRAMES = 4
const PLANET_READABILITY_SCALE = 3.7
const MINIMUM_PLANET_SCREEN_RADIUS = 0.52

function getPlanetPresentationRadius(body: BodyDefinition): number {
  return Math.max(body.presentationRadius * body.presentationScale * PLANET_READABILITY_SCALE, MINIMUM_PLANET_SCREEN_RADIUS)
}

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

function CanvasFailureFallback() {
  useEffect(() => {
    const current = getRenderDiagnostics()
    publishRenderDiagnostics({
      ...current,
      sceneReady: false,
      renderer: current.renderer === 'pending' ? 'WebGL unavailable' : current.renderer,
      lastError: current.lastError ?? 'WebGL context initialization failed. Enable hardware acceleration or choose a WebGL-capable browser.'
    })
  }, [])
  return <div className="webgl-fallback" role="alert"><strong>WebGL unavailable</strong><span>Try another browser or enable hardware acceleration.</span></div>
}

function rendererName(gl: WebGLRenderer): string {
  const context = gl.getContext()
  const value = context.getParameter(context.RENDERER)
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error('WebGL renderer diagnostics were unavailable')
  return value
}

function productionTextureUrl(path: string): string {
  // Public assets are rooted at the preview origin. Keep this as a root-relative
  // URL so the browser performs the normal same-origin request and decode,
  // including the production-preview sun map.
  return path
}

function fourCharacterCode(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])
}

function texturePayloadError(path: string, stage: string, details: string): Error {
  return new Error(`Could not decode ${path}: ${stage}: ${details}`)
}

/**
 * Validate and copy a WebP container before it reaches a browser decoder.
 * The checked-in maps predate the verifier and all have the same four-byte
 * RIFF length undercount; that exception is limited to the exact catalog
 * payload sizes and still requires a complete chunk walk to the response end.
 */
export function normalizeWebpPayload(path: string, input: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(input)
  if (bytes.length < 12) throw texturePayloadError(path, 'RIFF header', `response is ${bytes.length} bytes; at least 12 bytes are required`)
  if (fourCharacterCode(bytes, 0) !== 'RIFF' || fourCharacterCode(bytes, 8) !== 'WEBP') {
    throw texturePayloadError(path, 'RIFF header', 'response is not a RIFF WebP container')
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const declaredEnd = view.getUint32(4, true) + 8
  const catalogEntry = TEXTURE_CATALOG.find((entry) => entry.path === path)
  const catalogUndercount = Boolean(catalogEntry && declaredEnd + 4 === bytes.length && catalogEntry.bytes === bytes.length)
  if (catalogEntry && bytes.length !== catalogEntry.bytes) {
    throw texturePayloadError(path, 'RIFF boundary', `catalog response length ${bytes.length} does not match expected ${catalogEntry.bytes}`)
  }
  if (declaredEnd < 12 || declaredEnd > bytes.length) {
    throw texturePayloadError(path, 'RIFF boundary', `declared payload end ${declaredEnd} is outside response length ${bytes.length}`)
  }
  if (declaredEnd !== bytes.length && !catalogUndercount) {
    throw texturePayloadError(path, 'RIFF boundary', `declared payload end ${declaredEnd} does not match response length ${bytes.length}; only the unchanged catalog four-byte undercount is allowed`)
  }

  const validatedEnd = catalogUndercount ? bytes.length : declaredEnd
  let chunkOffset = 12
  let chunkCount = 0
  while (chunkOffset < validatedEnd) {
    if (validatedEnd - chunkOffset < 8) {
      throw texturePayloadError(path, 'chunk header', `incomplete header at byte ${chunkOffset}; validated payload ends at ${validatedEnd}`)
    }
    const chunkSize = new DataView(bytes.buffer, bytes.byteOffset + chunkOffset + 4, 4).getUint32(0, true)
    const payloadStart = chunkOffset + 8
    const payloadEnd = payloadStart + chunkSize
    if (payloadEnd > validatedEnd) {
      throw texturePayloadError(path, 'chunk payload', `chunk ${fourCharacterCode(bytes, chunkOffset)} at byte ${chunkOffset} ends at ${payloadEnd}, beyond validated payload end ${validatedEnd}`)
    }
    const paddedEnd = payloadEnd + (chunkSize % 2)
    if (paddedEnd > validatedEnd) {
      throw texturePayloadError(path, 'chunk padding', `odd-sized chunk ${fourCharacterCode(bytes, chunkOffset)} at byte ${chunkOffset} is missing its required padding byte`)
    }
    chunkOffset = paddedEnd
    chunkCount += 1
  }
  if (chunkCount === 0 || chunkOffset !== validatedEnd) {
    throw texturePayloadError(path, 'chunk walk', `ended at byte ${chunkOffset}; validated payload ends at ${validatedEnd}`)
  }

  // Slice creates an independent buffer. Repair the RIFF length in that copy
  // so the decoder sees exactly the validated chunk extent and never receives
  // bytes from a response suffix.
  const normalized = bytes.slice(0, validatedEnd)
  new DataView(normalized.buffer, normalized.byteOffset, normalized.byteLength).setUint32(4, validatedEnd - 8, true)
  return normalized
}

type TextureResource =
  | { status: 'pending'; promise: Promise<readonly Texture[]> }
  | { status: 'resolved'; value: readonly Texture[] }
  | { status: 'rejected'; error: Error }

const textureResources = new Map<string, TextureResource>()

function loadDecodedTexture(path: string): Promise<Texture> {
  const requestUrl = new URL(path, window.location.href)
  if (requestUrl.origin !== window.location.origin) {
    return Promise.reject(new Error(`Could not load ${path}: request origin ${requestUrl.origin} is not same-origin`))
  }

  return fetch(requestUrl, { credentials: 'same-origin' }).then(async (response) => {
    const responseUrl = new URL(response.url || requestUrl.href, window.location.href)
    if (responseUrl.origin !== window.location.origin) {
      throw new Error(`Could not load ${path}: response redirected to ${responseUrl.origin}, which is not same-origin`)
    }
    if (!response.ok) throw new Error(`Could not load ${path}: HTTP ${response.status} ${response.statusText}`)

    const bytes = new Uint8Array(await response.arrayBuffer())
    const normalizedBytes = normalizeWebpPayload(path, bytes)

    try {
      // Some delivered maps have four bytes beyond the RIFF-declared payload.
      // Decode the normalized in-memory bytes while the original public asset
      // remains unchanged.
      const blob = new Blob([normalizedBytes as unknown as BlobPart], { type: 'image/webp' })
      let image: ImageBitmap | HTMLImageElement
      try {
        image = await createImageBitmap(blob)
      } catch (bitmapError: unknown) {
        // Chromium's ImageBitmap path is strict about malformed historical
        // RIFF lengths (the unchanged local assets have four bytes beyond the
        // declared boundary). Retry through the browser's HTML image decoder,
        // while retaining the same independently bounded normalized payload.
        const objectUrl = URL.createObjectURL(blob)
        try {
          const element = new Image()
          element.src = objectUrl
          await element.decode()
          image = element
        } catch (imageError: unknown) {
          const bitmapMessage = bitmapError instanceof Error ? bitmapError.message : String(bitmapError)
          const imageMessage = imageError instanceof Error ? imageError.message : String(imageError)
          throw new Error(`ImageBitmap decode failed (${bitmapMessage}); HTMLImageElement decode failed (${imageMessage}); normalized payload end ${normalizedBytes.length}`)
        } finally {
          URL.revokeObjectURL(objectUrl)
        }
      }
      const texture = new Texture(image)
      texture.needsUpdate = true
      return texture
    } catch (error: unknown) {
      throw new Error(`Could not decode ${path}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }).catch((error: unknown) => {
    if (error instanceof Error && error.message.includes(path)) throw error
    throw new Error(`Could not load or decode ${path}: ${error instanceof Error ? error.message : String(error)}`)
  })
}

function readDecodedTextureCatalog(paths: readonly string[]): readonly Texture[] {
  const cacheKey = paths.join('\u0000')
  let resource = textureResources.get(cacheKey)
  if (!resource) {
    const promise = Promise.all(paths.map((path) => loadDecodedTexture(path)))
    resource = { status: 'pending', promise }
    textureResources.set(cacheKey, resource)
    promise.then(
      (value) => textureResources.set(cacheKey, { status: 'resolved', value }),
      (error: unknown) => textureResources.set(cacheKey, {
        status: 'rejected',
        error: error instanceof Error ? error : new Error(String(error))
      })
    )
  }
  if (resource.status === 'pending') throw resource.promise
  if (resource.status === 'rejected') throw resource.error
  return resource.value
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

function Planet({ body, texture, selected, onSelect, renderedPositions }: { body: BodyDefinition; texture: Texture | null; selected: boolean; onSelect: (id: BodyId) => void; renderedPositions: Map<BodyId, Vector3> }) {
  const mesh = useRef<Mesh>(null)
  const simulation = getSolarFrame()
  const state = simulation.getBodyState(body.id)
  const radius = getPlanetPresentationRadius(body)
  const emissive = {
    mercury: '#b9a590',
    venus: '#d58a69',
    earth: '#3d96a0',
    mars: '#c0523d',
    jupiter: '#aa795e',
    saturn: '#bd9e62',
    uranus: '#6bd2d9',
    neptune: '#5f7fda'
  }[body.id]
  const target = useMemo(() => new Vector3(), [])
  const source = useMemo(() => new Vector3(), [])
  useFrame((_, delta) => {
    const current = simulation.getBodyState(body.id)
    if (!mesh.current) return
    target.set(current.x, current.y, current.z)
    mesh.current.position.lerp(target, 1 - Math.pow(0.0001, delta))
    const renderedPosition = renderedPositions.get(body.id)
    if (renderedPosition) renderedPosition.copy(mesh.current.position)
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
    <meshStandardMaterial map={texture ?? undefined} color={selected ? '#fff0be' : '#ffffff'} emissive={emissive} emissiveIntensity={selected ? 0.88 : 0.68} roughness={body.id === 'earth' ? 0.48 : body.id === 'jupiter' || body.id === 'saturn' ? 0.78 : 0.9} metalness={0.02} transparent />
  </mesh>
}

function SaturnRings({ texture, renderedPositions }: { texture: Texture | null; renderedPositions: Map<BodyId, Vector3> }) {
  const group = useRef<Group>(null)
  const material = useRef<MeshStandardMaterial>(null)
  const target = useMemo(() => new Vector3(), [])
  const simulation = getSolarFrame()
  useFrame((_, delta) => {
    const state = simulation.getBodyState('saturn')
    if (!group.current) return
    target.set(state.x, state.y, state.z)
    group.current.position.lerp(target, 1 - Math.pow(0.0001, delta))
    const renderedPosition = renderedPositions.get('saturn')
    if (renderedPosition) renderedPosition.copy(group.current.position)
    group.current.rotation.y = state.rotation
    group.current.scale.setScalar(state.shrink)
    if (material.current) material.current.opacity = 0.82 * state.fade
  })
  return <group ref={group} rotation={[Math.PI / 2.55, 0, 0]}><mesh receiveShadow><ringGeometry args={[0.52, 1.32, 128]} /><meshStandardMaterial ref={material} map={texture ?? undefined} color="#ead5a4" emissive="#b08a3d" emissiveIntensity={0.82} transparent opacity={0.98} side={DoubleSide} alphaTest={0.12} roughness={0.78} /></mesh></group>
}

function updateScreenSpaceBounds(
  camera: Camera,
  width: number,
  height: number,
  bodyPositions: ReturnType<typeof getSolarFrame>['bodies'],
  renderedPositions: Map<BodyId, Vector3>,
  target: Record<string, { left: number; top: number; right: number; bottom: number; centerX: number; centerY: number; visible: boolean }>
) {
  const center = new Vector3()
  const edge = new Vector3()
  const ringPoint = new Vector3()
  const saturn = bodyPositions.find((body) => body.id === 'saturn')
  for (let index = 0; index < bodyPositions.length; index += 1) {
    const state = bodyPositions[index]
    const definition = BODY_CATALOG[index]
    const radius = getPlanetPresentationRadius(definition) * state.shrink
    const stretch = 1 + Math.max(0, state.tidalElongation - 1) * 0.38
    const renderedPosition = renderedPositions.get(state.id)
    center.set(renderedPosition?.x ?? state.x, renderedPosition?.y ?? state.y, renderedPosition?.z ?? state.z).project(camera)
    const screenX = (center.x * 0.5 + 0.5) * width
    const screenY = (-center.y * 0.5 + 0.5) * height
    const bounds = { left: screenX, top: screenY, right: screenX, bottom: screenY }
    const rotation = state.absorptionStage === 'none' ? 0 : state.rotation * 0.1
    for (const [x, y, z] of [[radius, 0, 0], [-radius, 0, 0], [0, radius, 0], [0, -radius, 0], [0, 0, radius * stretch], [0, 0, -radius * stretch]] as const) {
      const rotatedX = x * Math.cos(rotation) - z * Math.sin(rotation)
      const rotatedZ = x * Math.sin(rotation) + z * Math.cos(rotation)
      edge.set((renderedPosition?.x ?? state.x) + rotatedX, (renderedPosition?.y ?? state.y) + y, (renderedPosition?.z ?? state.z) + rotatedZ).project(camera)
      const edgeX = (edge.x * 0.5 + 0.5) * width
      const edgeY = (-edge.y * 0.5 + 0.5) * height
      bounds.left = Math.min(bounds.left, edgeX)
      bounds.top = Math.min(bounds.top, edgeY)
      bounds.right = Math.max(bounds.right, edgeX)
      bounds.bottom = Math.max(bounds.bottom, edgeY)
    }
    target[state.id] = {
      ...bounds,
      centerX: screenX,
      centerY: screenY,
      visible: center.z >= -1 && center.z <= 1 && bounds.right >= 0 && bounds.left <= width && bounds.bottom >= 0 && bounds.top <= height
    }
  }
  if (!saturn) return
  const ringBounds = { left: Number.POSITIVE_INFINITY, top: Number.POSITIVE_INFINITY, right: Number.NEGATIVE_INFINITY, bottom: Number.NEGATIVE_INFINITY }
  const ringTilt = Math.PI / 2.55
  const ringRotation = saturn.rotation
  const ringRadius = 1.32 * saturn.shrink
  for (let index = 0; index < 32; index += 1) {
    const angle = (index / 32) * Math.PI * 2
    const localX = Math.cos(angle) * ringRadius
    const localZ = Math.sin(angle) * ringRadius
    const rotatedX = localX * Math.cos(ringRotation) + localZ * Math.sin(ringRotation)
    const rotatedZ = -localX * Math.sin(ringRotation) + localZ * Math.cos(ringRotation)
    const renderedSaturn = renderedPositions.get('saturn')
    const saturnX = renderedSaturn?.x ?? saturn.x
    const saturnY = renderedSaturn?.y ?? saturn.y
    const saturnZ = renderedSaturn?.z ?? saturn.z
    const worldX = saturnX + rotatedX
    const worldY = saturnY - rotatedZ * Math.sin(ringTilt)
    const worldZ = saturnZ + rotatedZ * Math.cos(ringTilt)
    ringPoint.set(worldX, worldY, worldZ).project(camera)
    const screenX = (ringPoint.x * 0.5 + 0.5) * width
    const screenY = (-ringPoint.y * 0.5 + 0.5) * height
    ringBounds.left = Math.min(ringBounds.left, screenX)
    ringBounds.top = Math.min(ringBounds.top, screenY)
    ringBounds.right = Math.max(ringBounds.right, screenX)
    ringBounds.bottom = Math.max(ringBounds.bottom, screenY)
  }
  target['saturn-rings'] = { ...ringBounds, centerX: (ringBounds.left + ringBounds.right) / 2, centerY: (ringBounds.top + ringBounds.bottom) / 2, visible: ringBounds.right >= 0 && ringBounds.left <= width && ringBounds.bottom >= 0 && ringBounds.top <= height }
}

function SceneContent({ selectedBodyId, quality }: { selectedBodyId: BodyId | null; quality: keyof typeof QUALITY_TIERS }) {
  const textureUrls = useMemo(() => TEXTURE_CATALOG.map((entry) => productionTextureUrl(entry.path)), [])
  const textures = readDecodedTextureCatalog(textureUrls)
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
  const animationFrames = useRef(0)
  const renderer = useMemo(() => rendererName(gl), [gl])
  const screenSpaceBounds = useMemo(() => ({} as Record<string, { left: number; top: number; right: number; bottom: number; centerX: number; centerY: number; visible: boolean }>), [])
  const renderedPositions = useMemo(() => new Map<BodyId, Vector3>(), [])

  useEffect(() => {
    installDiagnosticsGetter()
  }, [])

  useEffect(() => {
    camera.position.set(0, 3.8, 12.8)
    if (controls.current) {
      controls.current.target.set(0, 0, 0)
      controls.current.update()
    }
  }, [camera, resetToken])

  useFrame((_, delta) => {
    simulation.advance(delta)
    animationFrames.current += 1
    if (!diagnosticsGate.current(_.clock.elapsedTime)) return

    const snapshot = simulation.getSnapshot()
    const selectedState = selected ? simulation.getBodyState(selected) : null
    const absorbingState = snapshot.bodies.find((body) => body.absorptionStage !== 'none')
    const current = getRenderDiagnostics()
    const texturesReady = textureMap.size === TEXTURE_CATALOG.length
    updateScreenSpaceBounds(camera, gl.domElement.clientWidth, gl.domElement.clientHeight, snapshot.bodies, renderedPositions, screenSpaceBounds)
    const sceneReady = texturesReady && snapshot.elapsedSeconds >= MINIMUM_READY_SECONDS && animationFrames.current >= MINIMUM_READY_FRAMES
    gl.domElement.dataset.sceneReady = String(sceneReady)
    publishRenderDiagnostics({
      ...current,
      sceneReady,
      renderer,
      textureDimensions: positions,
      simulationTime: snapshot.elapsedSeconds,
      frameCount: animationFrames.current,
      qualityTier: quality,
      interactionState: selectedState?.interaction ?? (snapshot.paused ? 'paused' : snapshot.blackHoleLevel > 0 ? 'black-hole' : snapshot.hoverAttractor ? 'hover-attractor' : 'inactive'),
      absorptionState: selectedState?.absorptionStage ?? absorbingState?.absorptionStage ?? 'none',
      bodyPositions: snapshot.bodies.map((body) => ({ id: body.id, x: body.x, y: body.y, z: body.z })),
      screenSpaceBounds
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
      return <group key={body.id}><OrbitPath radius={orbitRadius} opacity={0.08 + index * 0.008} /><Planet body={body} texture={textureMap.get(body.id) ?? null} selected={selected === body.id} onSelect={select} renderedPositions={renderedPositions} />{body.id === 'saturn' && <SaturnRings texture={textureMap.get('saturn-rings') ?? null} renderedPositions={renderedPositions} />}</group>
    })}
    <OrbitControls ref={controls} makeDefault enablePan={false} minDistance={3.2} maxDistance={16} dampingFactor={0.08} enableDamping rotateSpeed={0.42} zoomSpeed={0.62} />
  </>
}

class SceneBoundary extends Component<PropsWithChildren, { error: Error | null }> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error) {
    const current = getRenderDiagnostics()
    publishRenderDiagnostics({
      ...current,
      sceneReady: false,
      renderer: current.renderer === 'pending' ? 'WebGL unavailable' : current.renderer,
      lastError: `Scene initialization failed: ${error.message}`
    })
  }
  render() {
    if (this.state.error) return <div className="webgl-fallback" role="alert"><strong>WebGL unavailable</strong><span>Your browser could not start the local 3D view.</span></div>
    return this.props.children
  }
}

export function SolarCanvas({ selectedBodyId, quality }: { selectedBodyId: BodyId | null; quality: keyof typeof QUALITY_TIERS }) {
  const handleCreated = ({ gl }: { gl: WebGLRenderer }) => {
    gl.domElement.dataset.testid = 'solar-system-canvas'
    gl.domElement.dataset.sceneReady = 'false'
    try {
      publishRenderDiagnostics({ ...getRenderDiagnostics(), sceneReady: false, renderer: rendererName(gl), lastError: null })
    } catch (error) {
      publishRenderDiagnostics({
        ...getRenderDiagnostics(),
        sceneReady: false,
        renderer: 'WebGL unavailable',
        lastError: `WebGL context initialization failed: ${error instanceof Error ? error.message : String(error)}`
      })
    }
  }

  return <SceneBoundary><Canvas className="solar-canvas" dpr={[1, MAX_DPR]} camera={{ position: [0, 3.8, 12.8], fov: 52, near: 0.1, far: 60 }} shadows gl={{ antialias: true, powerPreference: 'high-performance' }} onCreated={handleCreated} fallback={<CanvasFailureFallback />}>
    <Suspense fallback={<LoadingState />}><SceneContent selectedBodyId={selectedBodyId} quality={quality} /></Suspense>
  </Canvas></SceneBoundary>
}
