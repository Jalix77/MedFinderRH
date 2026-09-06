'use client'

import { useState, useTransition } from 'react'
import { unstable_rethrow } from 'next/navigation'

export type ThirdPartyFormInitial = {
  id?: string
  legal_name: string
  commercial_name: string
  legal_form: string
  tax_id: string
  is_customer: boolean
  is_supplier: boolean
  email: string
  phone: string
  preferred_currency: 'HTG' | 'USD'
  payment_terms_days: string
  notes: string
}

/** Saisie d'une fiche tiers. Le backend (contraintes + RLS) reste l'autorite. */
export function ThirdPartyForm({
  action,
  initial,
  submitLabel,
  canCustomer,
  canSupplier,
}: {
  action: (formData: FormData) => Promise<void>
  initial: ThirdPartyFormInitial
  submitLabel: string
  canCustomer: boolean
  canSupplier: boolean
}) {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleSubmit(formData: FormData) {
    setError(null)
    startTransition(async () => {
      try {
        await action(formData)
      } catch (err) {
        unstable_rethrow(err)
        setError(err instanceof Error ? err.message : 'Action impossible.')
      }
    })
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}

      <div className="grid gap-4 rounded-2xl border border-mf-border bg-mf-surface p-4 shadow-sm sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="legal_name" className="block text-xs font-medium text-mf-navy-900">Raison sociale *</label>
          <input id="legal_name" name="legal_name" defaultValue={initial.legal_name} required
            className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
        </div>
        <div>
          <label htmlFor="commercial_name" className="block text-xs font-medium text-mf-navy-900">Nom commercial</label>
          <input id="commercial_name" name="commercial_name" defaultValue={initial.commercial_name}
            className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
        </div>
        <div>
          <label htmlFor="legal_form" className="block text-xs font-medium text-mf-navy-900">Forme juridique</label>
          <input id="legal_form" name="legal_form" defaultValue={initial.legal_form}
            className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
        </div>
        <div>
          <label htmlFor="tax_id" className="block text-xs font-medium text-mf-navy-900">NIF / identifiant fiscal</label>
          <input id="tax_id" name="tax_id" defaultValue={initial.tax_id}
            className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
          <p className="mt-1 text-xs text-slate-400">Aucun format impose — unique par organisation s&apos;il est renseigne.</p>
        </div>
        <div>
          <label htmlFor="preferred_currency" className="block text-xs font-medium text-mf-navy-900">Devise preferee</label>
          <select id="preferred_currency" name="preferred_currency" defaultValue={initial.preferred_currency}
            className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm">
            <option value="HTG">HTG</option>
            <option value="USD">USD</option>
          </select>
        </div>
        <div>
          <label htmlFor="email" className="block text-xs font-medium text-mf-navy-900">Email</label>
          <input id="email" name="email" type="email" defaultValue={initial.email}
            className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
        </div>
        <div>
          <label htmlFor="phone" className="block text-xs font-medium text-mf-navy-900">Telephone</label>
          <input id="phone" name="phone" defaultValue={initial.phone}
            className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
        </div>
        <div>
          <label htmlFor="payment_terms_days" className="block text-xs font-medium text-mf-navy-900">Delai de paiement (jours)</label>
          <input id="payment_terms_days" name="payment_terms_days" type="number" min="0"
            defaultValue={initial.payment_terms_days}
            className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
        </div>

        <fieldset className="sm:col-span-2">
          <legend className="text-xs font-medium text-mf-navy-900">Roles</legend>
          <div className="mt-2 flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="is_customer" defaultChecked={initial.is_customer} disabled={!canCustomer} />
              Client {!canCustomer && <span className="text-xs text-slate-400">(permission requise)</span>}
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="is_supplier" defaultChecked={initial.is_supplier} disabled={!canSupplier} />
              Fournisseur {!canSupplier && <span className="text-xs text-slate-400">(permission requise)</span>}
            </label>
          </div>
          <p className="mt-1 text-xs text-slate-400">Au moins un role est obligatoire.</p>
        </fieldset>

        <div className="sm:col-span-2">
          <label htmlFor="notes" className="block text-xs font-medium text-mf-navy-900">Notes</label>
          <textarea id="notes" name="notes" rows={2} defaultValue={initial.notes}
            className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
        </div>
      </div>

      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-mf-danger">{error}</p>}

      <button data-specular type="submit" disabled={pending}
        className="rounded-lg bg-mf-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-navy-800 disabled:opacity-60">
        {pending ? 'Enregistrement…' : submitLabel}
      </button>
    </form>
  )
}
