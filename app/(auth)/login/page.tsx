import type { Metadata } from 'next'
import { LoginForm } from '@/components/auth/login-form'

export const metadata: Metadata = {
  title: 'Connexion — MedFinder Gestion',
}

export default function LoginPage() {
  return (
    <>
      <h2 className="mb-6 text-lg font-semibold text-mf-navy-900">Connexion</h2>
      <LoginForm />
    </>
  )
}
