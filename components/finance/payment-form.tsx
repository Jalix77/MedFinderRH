'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { formatMoney } from '@/lib/format/money'

export type TreasuryOption = {
  /** Valeur composite "type:id" — l'utilisateur choisit un compte reel. */
  value: string
  label: string
  currency: string
}

/**
 * Saisie d'un encaissement client (Phase 2C.5A).
 *
 * AUCUNE regle metier n'est reimplementee ici. Les restrictions visibles
 * (comptes limites a la devise de la facture, montant borne par le solde)
 * sont des CONFORTS de saisie destines a eviter un aller-retour inutile :
 * l'autorite reste `record_customer_payment`, qui revalide statut,
 * devise, solde, organisation et periode comptable, et dont le refus est
 * affiche fidelement tel quel.
 */
export function PaymentForm({
  action,
  invoiceId,
  currency,
  balanceDue,
  treasuryAccounts,
}: {
  action: (formData: FormData) => Promise<void>
  invoiceId: string
  currency: string
  balanceDue: number
  treasuryAccounts: TreasuryOption[]
}) {
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const today = new Date().toISOString().slice(0, 10)

  function handleSubmit(formData: FormData) {
    setError(null)
    setSuccess(null)
    startTransition(async () => {
      try {
        await action(formData)
        setSuccess('Encaissement enregistre.')
        // Rafraichit montant paye, solde et statut depuis le serveur —
        // jamais une mise a jour optimiste cote client.
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Encaissement impossible.')
      }
    })
  }

  if (treasuryAccounts.length === 0) {
    return (
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
        Aucun compte de tresorerie en {currency} n&apos;est configure. Un encaissement doit se faire sur un compte
        de la meme devise que la facture.
      </p>
    )
  }

  return (
    <form action={handleSubmit} className="space-y-3">
      <input type="hidden" name="invoice_id" value={invoiceId} />

      <p className="text-sm text-slate-500">
        Solde avant paiement : <strong className="text-mf-navy-900">{formatMoney(balanceDue, currency)}</strong>
        {' — '}devise de la facture : <strong className="text-mf-navy-900">{currency}</strong>
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="treasury_account" className="block text-xs font-medium text-mf-navy-900">
            Compte de tresorerie
          </label>
          <select id="treasury_account" name="treasury_account" required
            className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm">
            <option value="">— Choisir —</option>
            {treasuryAccounts.map((a) => (
              <option key={a.value} value={a.value}>{a.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="amount" className="block text-xs font-medium text-mf-navy-900">
            Montant ({currency})
          </label>
          <input
            id="amount" name="amount" type="number" step="0.01" min="0.01" max={balanceDue}
            defaultValue={balanceDue > 0 ? String(balanceDue) : ''} required
            className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
        </div>

        <div>
          <label htmlFor="payment_date" className="block text-xs font-medium text-mf-navy-900">
            Date de paiement
          </label>
          <input id="payment_date" name="payment_date" type="date" defaultValue={today} required
            className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
        </div>

        <div>
          <label htmlFor="notes" className="block text-xs font-medium text-mf-navy-900">
            Reference (optionnel)
          </label>
          <input id="notes" name="notes" placeholder="N. de cheque, transaction…"
            className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
        </div>
      </div>

      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-mf-danger">{error}</p>}
      {success && <p role="status" className="rounded-lg bg-mf-emerald-50 px-3 py-2 text-sm text-mf-emerald-700">{success}</p>}

      <button type="submit" disabled={pending}
        className="rounded-lg bg-mf-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-navy-800 disabled:opacity-60">
        {pending ? 'Enregistrement…' : "Enregistrer l'encaissement"}
      </button>
    </form>
  )
}
