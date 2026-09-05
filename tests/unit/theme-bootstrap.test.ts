import { describe, expect, it } from 'vitest'
import { THEME_BOOTSTRAP_SCRIPT } from '@/lib/theme/appearance'

function bootstrap(values: Record<string, string>, systemDark = false, denied = false) {
  const attributes = new Map<string, string>()
  new Function('localStorage', 'document', 'window', THEME_BOOTSTRAP_SCRIPT)(
    { getItem: (key: string) => { if (denied) throw new Error('Storage unavailable'); return values[key] ?? null } },
    { documentElement: { setAttribute: (key: string, value: string) => attributes.set(key, value) } },
    { matchMedia: () => ({ matches: systemDark }) },
  )
  return attributes.get('data-mf-theme')
}

describe('Amorcage avant affichage — apparence MedFinder', () => {
  it('applique le choix sombre persiste avant React', () => {
    expect(bootstrap({ 'mf-appearance': 'dark' })).toBe('dark')
  })
  it('recupere le choix du prototype sans imposer ses anciennes palettes', () => {
    expect(bootstrap({ 'mf-preview-appearance': 'dark', 'mf-preview-accent': 'violet' })).toBe('dark')
    expect(bootstrap({ 'mf-appearance': 'light', 'mf-preview-appearance': 'dark' })).toBe('light')
  })
  it('resout le mode Systeme avant le premier affichage', () => {
    expect(bootstrap({ 'mf-appearance': 'system' }, true)).toBe('dark')
    expect(bootstrap({ 'mf-appearance': 'system' }, false)).toBe('light')
  })
  it('reste utilisable si le stockage est invalide ou refuse', () => {
    expect(bootstrap({ 'mf-appearance': 'invalid' })).toBe('light')
    expect(bootstrap({}, false, true)).toBe('light')
  })
})
