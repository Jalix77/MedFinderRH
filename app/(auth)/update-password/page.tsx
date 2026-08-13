import type { Metadata } from 'next'
import { UpdatePasswordForm } from '@/components/auth/update-password-form'

export const metadata: Metadata = {
  title: 'Nouveau mot de passe — MedFinder Gestion',
}

export default function UpdatePasswordPage() {
  return (
    <>
      <h2 className="mb-6 text-lg font-semibold text-mf-navy-900">Nouveau mot de passe</h2>
      <UpdatePasswordForm />
    </>
  )
}
