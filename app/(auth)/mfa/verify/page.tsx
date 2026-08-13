import type { Metadata } from 'next'
import { MfaVerifyForm } from '@/components/auth/mfa-verify-form'

export const metadata: Metadata = {
  title: 'Verification en deux etapes — MedFinder Gestion',
}

export default function MfaVerifyPage() {
  return (
    <>
      <h2 className="mb-2 text-lg font-semibold text-mf-navy-900">Verification en deux etapes</h2>
      <p className="mb-6 text-sm text-slate-500">
        Saisissez le code a 6 chiffres genere par votre application d&apos;authentification.
      </p>
      <MfaVerifyForm />
    </>
  )
}
