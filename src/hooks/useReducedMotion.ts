import { useEffect, useState } from 'react'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function readPreference(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}

export function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(readPreference)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY)
    const update = (event?: MediaQueryListEvent) => setReducedMotion(event?.matches ?? mediaQuery.matches)
    update()
    mediaQuery.addEventListener?.('change', update)
    mediaQuery.addListener?.(update)
    return () => {
      mediaQuery.removeEventListener?.('change', update)
      mediaQuery.removeListener?.(update)
    }
  }, [])

  return reducedMotion
}
