'use client'

import { useActionState } from 'react'
import { verifyMfaChallengeAction } from '@/app/actions/mfa'
import type { MfaChallengeState } from '@/app/actions/mfa'

const initialState: MfaChallengeState = { status: 'idle' }

export function MfaVerifyForm() {
  const [state, action, pending] = useActionState(verifyMfaChallengeAction, initialState)

  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="code" className="block text-sm font-medium text-mf-navy-900">
          Code de l&apos;application d&apos;authentification
        </label>
        <input
          id="code"
          name="code"
          type="text"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          autoComplete="one-time-code"
          required
          className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-center text-lg tracking-[0.5em] outline-none focus:border-mf-emerald-500 focus:ring-1 focus:ring-mf-emerald-500"
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
        {pending ? 'Verification...' : 'Verifier'}
      </button>
    </form>
  )
}
