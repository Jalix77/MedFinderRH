'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { requestPasswordResetAction } from '@/app/actions/auth'
import type { RequestPasswordResetState } from '@/lib/validation/auth'

const initialState: RequestPasswordResetState = { status: 'idle' }

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordResetAction, initialState)

  if (state.status === 'sent') {
    return (
      <div className="space-y-4 text-sm text-mf-navy-900">
        <p>
          Si un compte existe pour cette adresse, un lien de reinitialisation vient d&apos;etre
          envoye. Verifiez votre boite mail.
        </p>
        <Link href="/login" className="text-mf-navy-700 hover:underline">
          Retour a la connexion
        </Link>
      </div>
    )
  }

  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-mf-navy-900">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
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
        {pending ? 'Envoi...' : 'Envoyer le lien de reinitialisation'}
      </button>

      <div className="text-center text-sm">
        <Link href="/login" className="text-mf-navy-700 hover:underline">
          Retour a la connexion
        </Link>
      </div>
    </form>
  )
}
