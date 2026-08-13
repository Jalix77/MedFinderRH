'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getMfaAssurance, needsMfaChallenge } from '@/lib/auth/mfa'
import {
  LoginSchema,
  RequestPasswordResetSchema,
  UpdatePasswordSchema,
  type LoginFormState,
  type RequestPasswordResetState,
  type UpdatePasswordState,
} from '@/lib/validation/auth'

export async function loginAction(
  _prevState: LoginFormState,
  formData: FormData
): Promise<LoginFormState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })

  if (!parsed.success) {
    return { status: 'error', message: 'Email ou mot de passe invalide.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)

  if (error) {
    // Message generique volontaire (ne pas reveler si l'email existe).
    return { status: 'error', message: 'Identifiants incorrects.' }
  }

  const assurance = await getMfaAssurance()
  if (needsMfaChallenge(assurance)) {
    redirect('/mfa/verify')
  }

  redirect('/direction')
}

export async function logoutAction(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

export async function requestPasswordResetAction(
  _prevState: RequestPasswordResetState,
  formData: FormData
): Promise<RequestPasswordResetState> {
  const parsed = RequestPasswordResetSchema.safeParse({
    email: formData.get('email'),
  })

  if (!parsed.success) {
    return { status: 'error', message: 'Adresse email invalide.' }
  }

  const supabase = await createClient()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  // Ne jamais reveler si l'email correspond a un compte existant : la
  // reponse est toujours "sent", meme en cas d'erreur cote provider.
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${appUrl}/auth/callback?next=/update-password`,
  })

  return { status: 'sent' }
}

export async function updatePasswordAction(
  _prevState: UpdatePasswordState,
  formData: FormData
): Promise<UpdatePasswordState> {
  const parsed = UpdatePasswordSchema.safeParse({
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  })

  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Mot de passe invalide.',
    }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })

  if (error) {
    return { status: 'error', message: error.message }
  }

  return { status: 'success' }
}
