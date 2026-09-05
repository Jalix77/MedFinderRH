'use client'

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { APPEARANCE_STORAGE_KEY, LEGACY_APPEARANCE_STORAGE_KEY, DARK_MODE_QUERY, isAppearance, type AppearanceId } from '@/lib/theme/appearance'

// Store local du prototype, limite a l'apparence MedFinder (aucune palette alternative).
let cachedAppearance: AppearanceId = 'light'
let storageRead = false
const listeners = new Set<() => void>()

function applyAppearance(value: AppearanceId) {
  const dark = value === 'dark' || (value === 'system' && window.matchMedia(DARK_MODE_QUERY).matches)
  document.documentElement.setAttribute('data-mf-theme', dark ? 'dark' : 'light')
}

function subscribe(listener: () => void) {
  if (!storageRead) {
    storageRead = true
    try {
      const value = localStorage.getItem(APPEARANCE_STORAGE_KEY) || localStorage.getItem(LEGACY_APPEARANCE_STORAGE_KEY)
      if (isAppearance(value)) cachedAppearance = value
    } catch { /* stockage refuse : le choix reste utilisable pour cette session */ }
  }
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useAppearance() {
  const appearance = useSyncExternalStore(subscribe, () => cachedAppearance, () => 'light' as AppearanceId)

  useEffect(() => {
    if (appearance !== 'system') return
    const mq = window.matchMedia(DARK_MODE_QUERY)
    const onChange = () => applyAppearance('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [appearance])

  const setAppearance = useCallback((value: AppearanceId) => {
    cachedAppearance = value
    applyAppearance(value)
    for (const listener of listeners) listener()
    try { localStorage.setItem(APPEARANCE_STORAGE_KEY, value) } catch { /* affichage maintenu */ }
  }, [])

  return { appearance, setAppearance }
}
