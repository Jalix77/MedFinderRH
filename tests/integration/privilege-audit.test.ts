import { describe, it, expect } from 'vitest'
import { adminClient } from './helpers'

/**
 * Verification vivante (contre la base reellement en cours d'execution,
 * local ou cloud) du standard adopte en Phase 1B et rendu obligatoire pour
 * toute phase future (voir docs/phase-1c-plan.md §14) : aucune fonction
 * app_private ne doit etre executable par PUBLIC ou anon. Complement du
 * test statique tests/unit/app-private-grants-static.test.ts, qui verifie
 * la presence du REVOKE dans le texte des migrations mais ne peut pas
 * garantir qu'il a effectivement pris effet en base (c'est precisement le
 * mode de defaillance trouve en Phase 1B — voir 20260814090008).
 */
describe('Audit des privileges — aucune fonction app_private accessible a PUBLIC/anon', () => {
  it('debug_unwanted_function_grants(app_private) ne retourne aucune ligne', async () => {
    const admin = adminClient()
    const { data, error } = await admin.rpc('debug_unwanted_function_grants', { p_schema: 'app_private' })
    expect(error).toBeNull()
    expect(data, `Privileges indesirables trouves: ${JSON.stringify(data)}`).toEqual([])
  })

  it("la fonction d'audit elle-meme n'est pas accessible a anon", async () => {
    const { createClient } = await import('@supabase/supabase-js')
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { error } = await anon.rpc('debug_unwanted_function_grants', { p_schema: 'app_private' })
    expect(error).not.toBeNull()
  })
})
