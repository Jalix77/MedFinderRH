import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Garde-fou statique (pas de DB requise) : toute fonction cree/remplacee
 * dans le schema app_private doit recevoir un REVOKE EXECUTE ... FROM
 * PUBLIC explicite dans le texte des migrations (meme fichier ou un fichier
 * ulterieur), conformement au standard adopte en Phase 1B et rendu
 * obligatoire pour toute phase future (docs/phase-1c-plan.md §14). Ce test
 * aurait detecte immediatement la regression corrigee par
 * 20260814090008 (4 fonctions sans revoke explicite). Complementaire du
 * test vivant tests/integration/privilege-audit.test.ts, qui verifie l'etat
 * reel de la base plutot que le texte des migrations.
 */
const MIGRATIONS_DIR = path.resolve(__dirname, '../../supabase/migrations')

function readMigrationsInOrder(): { file: string; sql: string }[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ file: f, sql: fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf-8') }))
}

describe('Standard app_private — REVOKE explicite obligatoire (statique)', () => {
  const migrations = readMigrationsInOrder()
  const fullText = migrations.map((m) => m.sql).join('\n')

  const creationRegex = /create\s+(?:or\s+replace\s+)?function\s+app_private\.([a-z_][a-z0-9_]*)\s*\(/gi
  const createdFunctions = new Set([...fullText.matchAll(creationRegex)].map((m) => m[1]))

  // Une seule migration (20260813100015) a applique un revoke retroactif
  // "schema entier" — il ne protege que les fonctions qui EXISTAIENT DEJA
  // au moment ou il s'est execute (root cause confirmee en Phase 1B : le
  // revoke ne s'applique pas aux fonctions creees dans des fichiers
  // ULTERIEURS). On identifie ce fichier pivot pour distinguer les deux cas.
  const blanketRevokeRegex = /revoke\s+execute\s+on\s+all\s+functions\s+in\s+schema\s+app_private\s+from\s+public/i
  const blanketFileIndex = migrations.findIndex((m) => blanketRevokeRegex.test(m.sql))
  expect(blanketFileIndex, 'Le revoke retroactif de reference (20260813100015) est introuvable').toBeGreaterThanOrEqual(0)

  function firstCreationFileIndex(fnName: string): number {
    const fnCreationRegex = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+app_private\\.${fnName}\\s*\\(`, 'i')
    return migrations.findIndex((m) => fnCreationRegex.test(m.sql))
  }

  function hasExplicitRevoke(fnName: string): boolean {
    const revokeRegex = new RegExp(
      `revoke\\s+(?:all|execute)[^;]*\\bapp_private\\.${fnName}\\s*\\([^;]*from\\s+public`,
      'i'
    )
    return revokeRegex.test(fullText)
  }

  it('au moins une fonction app_private est definie (garde-fou anti faux-positif)', () => {
    expect(createdFunctions.size).toBeGreaterThan(0)
  })

  it.each([...createdFunctions])(
    '%s est protegee (revoke explicite, ou creee avant le revoke retroactif de reference)',
    (fnName) => {
      const createdAt = firstCreationFileIndex(fnName)
      const coveredByBlanket = createdAt >= 0 && createdAt <= blanketFileIndex
      const explicit = hasExplicitRevoke(fnName)
      expect(
        explicit || coveredByBlanket,
        `app_private.${fnName} n'a ni revoke explicite, ni couverture par le revoke retroactif ` +
          `(creee dans le fichier #${createdAt}, revoke retroactif au fichier #${blanketFileIndex}) — ` +
          'ajouter "revoke execute on function app_private.' +
          fnName +
          '(...) from public;" dans la migration qui la cree.'
      ).toBe(true)
    }
  )
})
