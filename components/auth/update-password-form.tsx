'use client'

import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { updatePasswordAction } from '@/app/actions/auth'
import type { UpdatePasswordState } from '@/lib/validation/auth'

const initialState: UpdatePasswordState = { status: 'idle' }

export function UpdatePasswordForm() {
  const [state, action, pending] = useActionState(updatePasswordAction, initialState)
  const router = useRouter()

  useEffect(() => {
    if (state.status === 'success') {
      const t = setTimeout(() => router.push('/login'), 1500)
      return () => clearTimeout(t)
    }
  }, [state.status, router])

  if (state.status === 'success') {
    return (
      <p className="text-sm text-mf-navy-900">
        Mot de passe mis a jour. Redirection vers la connexion...
      </p>
    )
  }

  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-mf-navy-900">
          Nouveau mot de passe
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm outline-none focus:border-mf-emerald-500 focus:ring-1 focus:ring-mf-emerald-500"
        />
        <p className="mt-1 text-xs text-slate-500">
          Au moins 10 caracteres, majuscule, minuscule et chiffre.
        </p>
      </div>
      <div>
        <label htmlFor="confirmPassword" className="block text-sm font-medium text-mf-navy-900">
          Confirmer le mot de passe
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm outline-none focus:border-mf-emerald-500 focus:ring-1 focus:ring-mf-emerald-500"
        />
      </div>

      {state.status === 'error' && (
        <p role="alert" className="text-sm text-mf-danger">
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-mf-navy-900 py-2.5 text-sm font-semibold text-white transition hover:bg-mf-navy-800 disabled:opacity-60"
      >
        {pending ? 'Enregistrement...' : 'Mettre a jour le mot de passe'}
      </button>
    </form>
  )
}
