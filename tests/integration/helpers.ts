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
