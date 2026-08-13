'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export type MfaChallengeState =
  | { status: 'idle' }
  | { status: 'error'; message: string }

export type EnrollTotpResult =
  | { status: 'error'; message: string }
  | { status: 'ok'; factorId: string; qrCodeSvg: string; secret: string }

/** Demarre l'enrolement d'un facteur TOTP (page Parametres > Securite). */
export async function enrollTotpAction(): Promise<EnrollTotpResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' })

  if (error || !data) {
    return { status: 'error', message: error?.message ?? 'Echec de l\'enrolement MFA.' }
  }

  return {
    status: 'ok',
    factorId: data.id,
    qrCodeSvg: data.totp.qr_code,
    secret: data.totp.secret,
  }
}

/** Finalise l'enrolement : verifie le premier code TOTP genere par l'app. */
export async function verifyEnrollTotpAction(
  factorId: string,
  code: string
): Promise<MfaChallengeState> {
  const supabase = await createClient()
  const { error: challengeError, data: challenge } = await supabase.auth.mfa.challenge({
    factorId,
  })
  if (challengeError || !challenge) {
    return { status: 'error', message: challengeError?.message ?? 'Echec du challenge MFA.' }
  }

  const { error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code,
  })

  if (error) {
    return { status: 'error', message: 'Code invalide.' }
  }

  return { status: 'idle' }
}

export async function unenrollFactorAction(factorId: string): Promise<MfaChallengeState> {
  const supabase = await createClient()
  const { error } = await supabase.auth.mfa.unenroll({ factorId })
  if (error) {
    return { status: 'error', message: error.message }
  }
  return { status: 'idle' }
}

/** Verifie le code TOTP au moment du login (session deja AAL1, cible AAL2). */
export async function verifyMfaChallengeAction(
  _prevState: MfaChallengeState,
  formData: FormData
): Promise<MfaChallengeState> {
  const code = String(formData.get('code') ?? '').trim()
  if (!/^\d{6}$/.test(code)) {
    return { status: 'error', message: 'Le code doit contenir 6 chiffres.' }
  }

  const supabase = await createClient()
  const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors()
  if (factorsError) {
    return { status: 'error', message: factorsError.message }
  }

  const factor = factors?.totp?.find((f) => f.status === 'verified')
  if (!factor) {
    return { status: 'error', message: 'Aucun facteur MFA verifie sur ce compte.' }
  }

  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
    factorId: factor.id,
  })
  if (challengeError || !challenge) {
    return { status: 'error', message: challengeError?.message ?? 'Echec du challenge MFA.' }
  }

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId: factor.id,
    challengeId: challenge.id,
    code,
  })

  if (verifyError) {
    return { status: 'error', message: 'Code invalide.' }
  }

  redirect('/direction')
}
