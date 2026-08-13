import { execSync } from 'node:child_process'

/**
 * Reinitialise la base Supabase locale (migrations + seed DEV) avant
 * l'execution de la suite de tests, pour un etat de depart deterministe —
 * independant de toute manipulation manuelle anterieure (ex. tests via le
 * navigateur). Necessite le stack Supabase local demarre (`supabase start`).
 */
export async function setup() {
  if (process.env.SKIP_DB_RESET === '1') {
    console.log('[global-setup] SKIP_DB_RESET=1 — reinitialisation ignoree (tests unitaires purs).')
    return
  }
  console.log('[global-setup] supabase db reset...')
  execSync('npx --yes supabase db reset', { stdio: 'inherit' })
}
