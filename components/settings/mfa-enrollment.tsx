'use client'

import { useState, useTransition } from 'react'
import { enrollTotpAction, verifyEnrollTotpAction } from '@/app/actions/mfa'

export function MfaEnrollment() {
  const [pending, startTransition] = useTransition()
  const [enrollment, setEnrollment] = useState<
    { factorId: string; qrCodeSvg: string; secret: string } | null
  >(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  function startEnrollment() {
    setError(null)
    startTransition(async () => {
      const result = await enrollTotpAction()
      if (result.status === 'error') {
        setError(result.message)
        return
      }
      setEnrollment({
        factorId: result.factorId,
        qrCodeSvg: result.qrCodeSvg,
        secret: result.secret,
      })
    })
  }

  function verify(formData: FormData) {
    if (!enrollment) return
    setError(null)
    const code = String(formData.get('code') ?? '')
    startTransition(async () => {
      const result = await verifyEnrollTotpAction(enrollment.factorId, code)
      if (result.status === 'error') {
        setError(result.message)
        return
      }
      setDone(true)
    })
  }

  if (done) {
    return (
      <p className="text-sm text-mf-emerald-600">
        Authentification a deux facteurs activee. Rechargez la page pour continuer.
      </p>
    )
  }

  if (!enrollment) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-500">
          Aucun facteur d&apos;authentification a deux facteurs n&apos;est configure sur ce
          compte.
        </p>
        <button
          type="button"
          onClick={startEnrollment}
          disabled={pending}
          className="rounded-lg bg-mf-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-navy-800 disabled:opacity-60"
        >
          {pending ? 'Preparation...' : 'Activer la verification en deux etapes'}
        </button>
        {error && <p className="text-sm text-mf-danger">{error}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Scannez ce QR code avec votre application d&apos;authentification (Google
        Authenticator, Authy, 1Password...), puis saisissez le code genere.
      </p>
      <div
        className="h-48 w-48 rounded-lg border border-mf-border bg-white p-2"
        dangerouslySetInnerHTML={{ __html: enrollment.qrCodeSvg }}
      />
      <p className="break-all text-xs text-slate-400">Cle manuelle : {enrollment.secret}</p>

      <form action={verify} className="flex items-end gap-3">
        <div>
          <label htmlFor="code" className="block text-xs font-medium text-mf-navy-900">
            Code a 6 chiffres
          </label>
          <input
            id="code"
            name="code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            className="mt-1 w-32 rounded-lg border border-mf-border px-3 py-2 text-center tracking-widest"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-mf-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-emerald-500 disabled:opacity-60"
        >
          Confirmer
        </button>
      </form>
      {error && <p className="text-sm text-mf-danger">{error}</p>}
    </div>
  )
}
