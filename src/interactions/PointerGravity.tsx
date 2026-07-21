import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Plane, Raycaster, Vector2, Vector3 } from 'three'
import { getSolarFrame, useSolarStore } from '../state/solarStore'

const POINTER_DRAG_THRESHOLD = 7
const POINTER_SMOOTHING = 0.16

/** Shared mutable source position keeps renderers allocation-free between frames. */
export const pointerGravityPosition = new Vector3()

const planetPointerGestures = new Set<number>()

/** Marks the active primary pointer gesture as having started on a rendered body. */
export function markPlanetPointerGesture(pointerId: number): void {
  planetPointerGestures.add(pointerId)
}

function clearPlanetPointerGesture(pointerId: number): void {
  planetPointerGestures.delete(pointerId)
}

function isPrimaryCanvasClick(event: PointerEvent, canvas: HTMLCanvasElement, down: { x: number; y: number; pointerId: number } | null): boolean {
  if (!down || event.button !== 0 || event.isPrimary === false || event.pointerId !== down.pointerId || event.target !== canvas) return false
  return Math.hypot(event.clientX - down.x, event.clientY - down.y) <= POINTER_DRAG_THRESHOLD
}

/**
 * Projects the real canvas pointer onto the simulation's orbital plane. Native
 * listeners are used here so OrbitControls keeps ownership of camera gestures;
 * this controller only observes the gesture and promotes a short primary click.
 */
export function PointerGravity() {
  const { camera, gl } = useThree()
  const simulation = getSolarFrame()
  const fullSceneResetToken = useSolarStore((state) => state.fullSceneResetToken)
  const pointer = useMemo(() => new Vector2(), [])
  const raycaster = useMemo(() => new Raycaster(), [])
  const interactionPlane = useMemo(() => new Plane(new Vector3(0, 1, 0), 0), [])
  const projected = useMemo(() => new Vector3(), [])
  const smoothed = useMemo(() => new Vector3(), [])
  const down = useRef<{ x: number; y: number; pointerId: number } | null>(null)
  const hasProjection = useRef(false)
  const hovered = useRef(false)
  const hoverSynced = useRef(false)

  useEffect(() => {
    const canvas = gl.domElement
    const onPointerMove = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect()
      if (bounds.width === 0 || bounds.height === 0) return
      pointer.set(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        -((event.clientY - bounds.top) / bounds.height) * 2 + 1
      )
      hovered.current = true
      raycaster.setFromCamera(pointer, camera)
      if (raycaster.ray.intersectPlane(interactionPlane, projected)) {
        if (!hasProjection.current) smoothed.copy(projected)
        hasProjection.current = true
        if (!hoverSynced.current && !simulation.isBlackHoleActive) {
          useSolarStore.getState().setHoverAttractor(true)
          simulation.setHoverAttractor(true, projected)
          hoverSynced.current = true
        }
      }
    }
    const onPointerLeave = () => {
      hovered.current = false
      hasProjection.current = false
      if (down.current) clearPlanetPointerGesture(down.current.pointerId)
      if (hoverSynced.current && !simulation.isBlackHoleActive) {
        pointerGravityPosition.set(0, 0, 0)
        simulation.setHoverAttractor(false)
        useSolarStore.getState().setHoverAttractor(false)
      }
      hoverSynced.current = false
      down.current = null
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.button === 0 && event.isPrimary !== false) down.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId }
    }
    const onPointerUp = (event: PointerEvent) => {
      const startedOnPlanet = planetPointerGestures.has(event.pointerId)
      if (!startedOnPlanet && isPrimaryCanvasClick(event, canvas, down.current) && hovered.current && hasProjection.current) {
        simulation.triggerBlackHole(smoothed)
        useSolarStore.getState().triggerBlackHole()
      }
      clearPlanetPointerGesture(event.pointerId)
      down.current = null
    }
    const onPointerCancel = (event: PointerEvent) => {
      clearPlanetPointerGesture(event.pointerId)
      down.current = null
    }

    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerleave', onPointerLeave)
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerCancel)
    // Pointer capture can be lost outside the canvas; keep the gesture marker
    // bounded to the exact native gesture even when completion happens on the
    // window rather than on the renderer element.
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    return () => {
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerCancel)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
      if (down.current) clearPlanetPointerGesture(down.current.pointerId)
    }
  }, [camera, gl, interactionPlane, pointer, projected, raycaster, simulation, smoothed])

  useEffect(() => {
    if (down.current) clearPlanetPointerGesture(down.current.pointerId)
    down.current = null
    hovered.current = false
    hasProjection.current = false
    hoverSynced.current = false
    pointer.set(0, 0)
    projected.set(0, 0, 0)
    smoothed.set(0, 0, 0)
    pointerGravityPosition.set(0, 0, 0)
    simulation.setHoverAttractor(false)
  }, [fullSceneResetToken, pointer, projected, simulation, smoothed])

  useFrame(() => {
    if (simulation.isBlackHoleActive || !hovered.current || !hasProjection.current) return
    smoothed.lerp(projected, POINTER_SMOOTHING)
    pointerGravityPosition.copy(smoothed)
    simulation.setHoverAttractor(true, smoothed)
  })

  return null
}
