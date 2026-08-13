import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Point d'echange PKCE pour les liens envoyes par email (reinitialisation
 * de mot de passe, confirmation d'inscription). Voir @supabase/ssr —
 * pattern standard pour App Router.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/update-password'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
