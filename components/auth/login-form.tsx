'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { loginAction } from '@/app/actions/auth'
import type { LoginFormState } from '@/lib/validation/auth'

const initialState: LoginFormState = { status: 'idle' }

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, initialState)

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
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-mf-navy-900">
          Mot de passe
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
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
        {pending ? 'Connexion...' : 'Se connecter'}
      </button>

      <div className="text-center text-sm">
        <Link href="/reset-password" className="text-mf-navy-700 hover:underline">
          Mot de passe oublie ?
        </Link>
      </div>
    </form>
  )
}
