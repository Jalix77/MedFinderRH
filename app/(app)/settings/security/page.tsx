import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { MfaEnrollment } from '@/components/settings/mfa-enrollment'
import { MfaUnenrollButton } from '@/components/settings/mfa-unenroll-button'

export const metadata: Metadata = { title: 'Securite — MedFinder Gestion' }

export default async function SecuritySettingsPage() {
  const supabase = await createClient()
  const { data: factorsData } = await supabase.auth.mfa.listFactors()
  const verifiedFactors = factorsData?.totp?.filter((f) => f.status === 'verified') ?? []

  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-xl font-bold text-mf-navy-900">Securite du compte</h1>

      <div className="rounded-2xl border border-mf-border bg-mf-surface p-6 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-mf-navy-900">
          Authentification a deux facteurs (MFA)
        </h2>

        {verifiedFactors.length > 0 ? (
          <ul className="space-y-2">
            {verifiedFactors.map((factor) => (
              <li
                key={factor.id}
                className="flex items-center justify-between rounded-lg bg-mf-emerald-50 px-3 py-2 text-sm"
              >
                <span className="text-mf-emerald-700">
                  Facteur actif — {new Date(factor.created_at).toLocaleDateString('fr-FR')}
                </span>
                <MfaUnenrollButton factorId={factor.id} />
              </li>
            ))}
          </ul>
        ) : (
          <MfaEnrollment />
        )}
      </div>

      <p className="text-xs text-slate-400">
        Le MFA est obligatoire pour les roles SUPER_ADMIN et DIRECTEUR_GENERAL, et pour
        DIRECTEUR_TECHNIQUE lorsqu&apos;il detient une permission administrative sensible —
        voir docs/roadmap.md, Decision D2.
      </p>
    </div>
  )
}
