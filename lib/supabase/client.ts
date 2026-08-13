import { createBrowserClient } from '@supabase/ssr'
import type { Database } from './database.types'

/**
 * Client Supabase cote navigateur (Client Components). Utilise uniquement
 * la cle publique NEXT_PUBLIC_SUPABASE_ANON_KEY — jamais service_role.
 * Toute requete passe par PostgREST et reste soumise a RLS.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
