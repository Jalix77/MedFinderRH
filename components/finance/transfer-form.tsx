'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { transferBudgetAmountAction } from '@/app/actions/budget'

/**
 * Formulaire de transfert budgetaire — protection double-soumission via
 * useTransition (bouton desactive pendant l'appel RPC), erreurs backend
 * affichees fidelement (§ regles de securite UI : le backend reste
 * l'autorite, l'UI se contente de relayer sa reponse).
 */
export function TransferForm({
  budgetId,
  lines,
}: {
  budgetId: string
  lines: { id: string; category: string }[]
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const router = useRouter()

  function handleSubmit(formData: FormData) {
    setError(null)
    setSuccess(false)
    startTransition(async () => {
      try {
        await transferBudgetAmountAction(formData)
        formRef.current?.reset()
        setSuccess(true)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Echec du transfert.')
      }
    })
  }

  return (
    <form ref={formRef} action={handleSubmit} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <input type="hidden" name="budget_id" value={budgetId} />
      <div>
        <label htmlFor="from_line_id" className="block text-xs font-medium text-mf-navy-900">De la ligne</label>
        <select id="from_line_id" name="from_line_id" required className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm">
          <option value="">—</option>
          {lines.map((l) => (
            <option key={l.id} value={l.id}>
              {l.category}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="to_line_id" className="block text-xs font-medium text-mf-navy-900">Vers la ligne</label>
        <select id="to_line_id" name="to_line_id" required className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm">
          <option value="">—</option>
          {lines.map((l) => (
            <option key={l.id} value={l.id}>
              {l.category}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="transfer_amount" className="block text-xs font-medium text-mf-navy-900">Montant</label>
        <input
          id="transfer_amount"
          type="number"
          step="0.01"
          min="0.01"
          name="amount"
          required
          className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label htmlFor="transfer_reason" className="block text-xs font-medium text-mf-navy-900">Justification</label>
        <input id="transfer_reason" name="reason" required className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
      </div>
      <div className="col-span-2 sm:col-span-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-mf-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-navy-800 disabled:opacity-60"
        >
          {pending ? 'Transfert...' : 'Transferer'}
        </button>
        {error && <p className="mt-2 text-sm text-mf-danger">{error}</p>}
        {success && <p className="mt-2 text-sm text-mf-emerald-600">Transfert effectue.</p>}
      </div>
    </form>
  )
}
