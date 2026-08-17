import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// @supabase/supabase-js construit un client Realtime des createClient(),
// ce qui requiert un WebSocket natif (Node >= 22). Polyfill pour Node 20 —
// voir la meme note dans scripts/bootstrap-super-admin.mjs.
if (typeof globalThis.WebSocket === 'undefined') {
  const { default: WS } = await import('ws')
  ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = WS
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  throw new Error(
    'NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY ' +
      'doivent etre definis (voir .env.local) pour executer les tests d\'integration.'
  )
}

export const DEMO_PASSWORD = 'DemoPass#2026'

export function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function signInAs(email: string): Promise<{ client: SupabaseClient; userId: string }> {
  const client = createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await client.auth.signInWithPassword({ email, password: DEMO_PASSWORD })
  if (error || !data.user) {
    throw new Error(`Echec de connexion pour ${email}: ${error?.message}`)
  }
  return { client, userId: data.user.id }
}

export async function getOrgIdByName(name: string): Promise<string> {
  const admin = adminClient()
  const { data, error } = await admin.from('organizations').select('id').eq('name', name).single()
  if (error || !data) {
    throw new Error(`Organisation "${name}" introuvable: ${error?.message}`)
  }
  return (data as { id: string }).id
}

/**
 * SUPER_ADMIN et DIRECTEUR_GENERAL exigent AAL2 pour TOUTE permission
 * (app_private.user_requires_mfa/is_super_admin, Phase 1A) — un simple
 * signInAs() ne suffit pas pour tester un scenario ou l'un de ces roles
 * doit REUSSIR une action gardee par permission. Reutilise le cycle
 * enrolement/verification TOTP deja etabli par
 * tests/integration/mfa-enforcement.test.ts, factorise ici pour les
 * suites Phase 1C qui en ont besoin ponctuellement (ex. approbation par un
 * DG, validation d'exception par un SUPER_ADMIN). Toujours desenroler via
 * la fonction retournee (finally / afterAll) pour ne pas laisser un
 * facteur MFA residuel perturber d'autres tests sur le meme compte.
 */
export async function signInAsElevated(
  email: string
): Promise<{ client: SupabaseClient; userId: string; deElevate: () => Promise<void> }> {
  const { client, userId } = await signInAs(email)
  const { computeTotp } = await import('./totp')

  // Auto-guerison : un test precedent interrompu (ex. rate limit Supabase
  // Auth en plein run, deja observe dans ce sandbox sous forte charge)
  // entre l'enrolement et deElevate() laisse un facteur TOTP residuel avec
  // le nom par defaut "" — bloquant tout enrolement futur pour ce meme
  // compte (mfa_factor_name_conflict, 422). Nettoyage defensif via l'API
  // admin avant chaque enrolement plutot qu'une supposition d'etat propre.
  const admin = adminClient()
  const { data: existingFactors } = await admin.auth.admin.mfa.listFactors({ userId })
  for (const factor of existingFactors?.factors ?? []) {
    await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId })
  }

  const { data: enroll, error: enrollError } = await client.auth.mfa.enroll({ factorType: 'totp' })
  if (enrollError || !enroll) {
    throw new Error(`Echec enrolement MFA pour ${email}: ${enrollError?.message}`)
  }
  const factorId = enroll.id
  const secret = enroll.totp.secret

  const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({ factorId })
  if (challengeError || !challenge) {
    throw new Error(`Echec challenge MFA pour ${email}: ${challengeError?.message}`)
  }

  const { error: verifyError } = await client.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code: computeTotp(secret),
  })
  if (verifyError) {
    throw new Error(`Echec verification MFA pour ${email}: ${verifyError.message}`)
  }

  return {
    client,
    userId,
    deElevate: async () => {
      await client.auth.mfa.unenroll({ factorId })
    },
  }
}
