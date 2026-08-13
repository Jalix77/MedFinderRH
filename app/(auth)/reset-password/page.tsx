import type { Metadata } from 'next'
import { ResetPasswordForm } from '@/components/auth/reset-password-form'

export const metadata: Metadata = {
  title: 'Mot de passe oublie — MedFinder Gestion',
}

export default function ResetPasswordPage() {
  return (
    <>
      <h2 className="mb-6 text-lg font-semibold text-mf-navy-900">Mot de passe oublie</h2>
      <ResetPasswordForm />
    </>
  )
}
