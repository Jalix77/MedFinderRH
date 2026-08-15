import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { PERMISSION_CODES, ROLE_CODES } from '@/lib/permissions/codes'

/**
 * Garde-fou anti-derive : lib/permissions/codes.ts est maintenu a la main
 * (voir son commentaire d'en-tete) en miroir des migrations SQL qui
 * seedent le catalogue RBAC (Phase 1A + toute extension ulterieure, ex.
 * 20260814090001 pour la Phase 1B). Ce test echoue si les deux divergent —
 * il concatene TOUTES les migrations plutot qu'un seul fichier pour rester
 * valable au fil des phases.
 */
const MIGRATIONS_DIR = path.resolve(__dirname, '../../supabase/migrations')

function readAllMigrations(): string {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'))
  return files.map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf-8')).join('\n')
}

describe('Synchronisation catalogue RBAC (TS <-> SQL)', () => {
  const sql = readAllMigrations()

  it('chaque code de permission TS existe dans les migrations SQL', () => {
    for (const code of PERMISSION_CODES) {
      expect(sql.includes(`'${code}'`), `Permission manquante en SQL: ${code}`).toBe(true)
    }
  })

  it('chaque role TS existe dans les migrations SQL', () => {
    for (const code of ROLE_CODES) {
      expect(sql.includes(`'${code}'`), `Role manquant en SQL: ${code}`).toBe(true)
    }
  })

  it('les migrations ne definissent pas de permission absente du catalogue TS', () => {
    const matches = [...sql.matchAll(/^\s*\('([a-z_]+\.[a-z_]+)',\s*'/gm)].map((m) => m[1])
    const sqlPermissionCodes = new Set(matches)
    for (const code of sqlPermissionCodes) {
      expect(
        (PERMISSION_CODES as readonly string[]).includes(code),
        `Permission SQL absente du catalogue TS: ${code}`
      ).toBe(true)
    }
  })
})
