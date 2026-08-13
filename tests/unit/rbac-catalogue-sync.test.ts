import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { PERMISSION_CODES, ROLE_CODES } from '@/lib/permissions/codes'

/**
 * Garde-fou anti-derive : lib/permissions/codes.ts est maintenu a la main
 * (voir son commentaire d'en-tete) en miroir de la migration SQL qui seede
 * le catalogue RBAC. Ce test echoue si les deux divergent.
 */
const MIGRATION_PATH = path.resolve(
  __dirname,
  '../../supabase/migrations/20260813100011_seed_rbac_catalogue.sql'
)

describe('Synchronisation catalogue RBAC (TS <-> SQL)', () => {
  const sql = fs.readFileSync(MIGRATION_PATH, 'utf-8')

  it('chaque code de permission TS existe dans la migration SQL', () => {
    for (const code of PERMISSION_CODES) {
      expect(sql.includes(`'${code}'`), `Permission manquante en SQL: ${code}`).toBe(true)
    }
  })

  it('chaque role TS existe dans la migration SQL', () => {
    for (const code of ROLE_CODES) {
      expect(sql.includes(`'${code}'`), `Role manquant en SQL: ${code}`).toBe(true)
    }
  })

  it('la migration ne definit pas de permission absente du catalogue TS', () => {
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
