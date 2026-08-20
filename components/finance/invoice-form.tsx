'use client'

import { useMemo, useState, useTransition } from 'react'
import { unstable_rethrow } from 'next/navigation'
import { formatMoney } from '@/lib/format/money'

type Option = { id: string; label: string }
type TaxOption = { id: string; label: string; rate_percent: number }
type LineState = {
  description: string
  quantity: string
  unit_price: string
  revenue_account_id: string
  tax_rate_id: string
}

export type InvoiceFormInitial = {
  id?: string
  document_type: 'INVOICE' | 'CREDIT_NOTE'
  third_party_id: string
  credited_invoice_id: string
  credit_reason: string
  document_date: string
  due_date: string
  currency: 'HTG' | 'USD'
  exchange_rate_to_htg: string
  external_reference: string
  notes: string
  cost_center_id: string
  lines: LineState[]
}

const EMPTY_LINE: LineState = {
  description: '',
  quantity: '1',
  unit_price: '0',
  revenue_account_id: '',
  tax_rate_id: '',
}

/**
 * Saisie d'un brouillon de facture / avoir.
 *
 * Les totaux affiches ici sont un APERCU de confort : la base recalcule
 * systematiquement line_subtotal / tax_amount / line_total (colonnes
 * generees) et les totaux d'en-tete (trigger). L'ecran n'est jamais la
 * source de verite — il ne fait que refleter la meme formule pour eviter
 * une saisie a l'aveugle.
 */
export function InvoiceForm({
  action,
  initial,
  customers,
  revenueAccounts,
  taxRates,
  costCenters,
  issuedInvoices,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<void>
  initial: InvoiceFormInitial
  customers: Option[]
  revenueAccounts: Option[]
  taxRates: TaxOption[]
  costCenters: Option[]
  issuedInvoices: Option[]
  submitLabel: string
}) {
  const [documentType, setDocumentType] = useState(initial.document_type)
  const [currency, setCurrency] = useState(initial.currency)
  const [rate, setRate] = useState(initial.exchange_rate_to_htg)
  const [lines, setLines] = useState<LineState[]>(
    initial.lines.length > 0 ? initial.lines : [{ ...EMPTY_LINE }]
  )
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const taxById = useMemo(() => Object.fromEntries(taxRates.map((t) => [t.id, t])), [taxRates])

  const totals = useMemo(() => {
    let subtotal = 0
    let tax = 0
    for (const l of lines) {
      const qty = Number(l.quantity) || 0
      const price = Number(l.unit_price) || 0
      const lineSub = Math.round(qty * price * 100) / 100
      const pct = l.tax_rate_id ? (taxById[l.tax_rate_id]?.rate_percent ?? 0) : 0
      subtotal += lineSub
      tax += Math.round(((lineSub * pct) / 100) * 100) / 100
    }
    return { subtotal, tax, total: subtotal + tax }
  }, [lines, taxById])

  function updateLine(index: number, patch: Partial<LineState>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }

  function handleSubmit(formData: FormData) {
    setError(null)
    formData.set(
      'lines',
      JSON.stringify(
        lines.map((l) => ({
          description: l.description,
          quantity: Number(l.quantity),
          unit_price: Number(l.unit_price),
          revenue_account_id: l.revenue_account_id,
          tax_rate_id: l.tax_rate_id || null,
        }))
      )
    )
    startTransition(async () => {
      try {
        await action(formData)
      } catch (err) {
        // redirect() de Next leve une erreur interne qui DOIT remonter.
        unstable_rethrow(err)
        setError(err instanceof Error ? err.message : 'Action impossible.')
      }
    })
  }

  const isCredit = documentType === 'CREDIT_NOTE'

  return (
    <form action={handleSubmit} className="space-y-6">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}

      <section className="grid gap-4 rounded-2xl border border-mf-border bg-mf-surface p-4 shadow-sm sm:grid-cols-2">
        <div>
          <label htmlFor="document_type" className="block text-xs font-medium text-mf-navy-900">Type de document</label>
          <select
            id="document_type" name="document_type" value={documentType}
            onChange={(e) => setDocumentType(e.target.value as 'INVOICE' | 'CREDIT_NOTE')}
            className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm"
          >
            <option value="INVOICE">Facture</option>
            <option value="CREDIT_NOTE">Avoir</option>
          </select>
        </div>

        <div>
          <label htmlFor="third_party_id" className="block text-xs font-medium text-mf-navy-900">Client</label>
          <select
            id="third_party_id" name="third_party_id" defaultValue={initial.third_party_id} required
            className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm"
          >
            <option value="">— Choisir —</option>
            {customers.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
          </select>
        </div>

        {isCredit && (
          <>
            <div>
              <label htmlFor="credited_invoice_id" className="block text-xs font-medium text-mf-navy-900">Facture creditee</label>
              <select
                id="credited_invoice_id" name="credited_invoice_id" defaultValue={initial.credited_invoice_id}
                className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm"
              >
                <option value="">— Choisir —</option>
                {issuedInvoices.map((i) => (<option key={i.id} value={i.id}>{i.label}</option>))}
              </select>
            </div>
            <div>
              <label htmlFor="credit_reason" className="block text-xs font-medium text-mf-navy-900">Motif de l&apos;avoir</label>
              <input
                id="credit_reason" name="credit_reason" defaultValue={initial.credit_reason}
                className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm"
              />
            </div>
          </>
        )}

        <div>
          <label htmlFor="document_date" className="block text-xs font-medium text-mf-navy-900">Date du document</label>
          <input id="document_date" type="date" name="document_date" defaultValue={initial.document_date} required
            className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
        </div>
        <div>
          <label htmlFor="due_date" className="block text-xs font-medium text-mf-navy-900">Echeance</label>
          <input id="due_date" type="date" name="due_date" defaultValue={initial.due_date} required
            className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
        </div>

        <div>
          <label htmlFor="currency" className="block text-xs font-medium text-mf-navy-900">Devise</label>
          <select
            id="currency" name="currency" value={currency}
            onChange={(e) => {
              const next = e.target.value as 'HTG' | 'USD'
              setCurrency(next)
              if (next === 'HTG') setRate('1')
            }}
            className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm"
          >
            <option value="HTG">HTG</option>
            <option value="USD">USD</option>
          </select>
        </div>
        <div>
          <label htmlFor="exchange_rate_to_htg" className="block text-xs font-medium text-mf-navy-900">
            Taux vers HTG {currency === 'HTG' && <span className="text-slate-400">(fige a 1)</span>}
          </label>
          <input
            id="exchange_rate_to_htg" name="exchange_rate_to_htg" type="number" step="0.000001" min="0.000001"
            value={currency === 'HTG' ? '1' : rate}
            onChange={(e) => setRate(e.target.value)}
            disabled={currency === 'HTG'}
            className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm disabled:bg-slate-50"
          />
        </div>

        <div>
          <label htmlFor="external_reference" className="block text-xs font-medium text-mf-navy-900">Reference externe</label>
          <input id="external_reference" name="external_reference" defaultValue={initial.external_reference}
            className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
        </div>
        <div>
          <label htmlFor="cost_center_id" className="block text-xs font-medium text-mf-navy-900">Centre de cout</label>
          <select id="cost_center_id" name="cost_center_id" defaultValue={initial.cost_center_id}
            className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm">
            <option value="">— Aucun —</option>
            {costCenters.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
          </select>
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="notes" className="block text-xs font-medium text-mf-navy-900">Notes</label>
          <textarea id="notes" name="notes" defaultValue={initial.notes} rows={2}
            className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
        </div>
      </section>

      {/* --- Lignes --- */}
      <section className="space-y-3 rounded-2xl border border-mf-border bg-mf-surface p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-mf-navy-900">Lignes</h2>
          <button type="button" onClick={() => setLines((p) => [...p, { ...EMPTY_LINE }])}
            className="rounded-lg border border-mf-border px-3 py-1.5 text-xs font-semibold text-mf-navy-700 hover:bg-slate-50">
            Ajouter une ligne
          </button>
        </div>

        {lines.map((line, index) => (
          <div key={index} className="grid gap-2 border-t border-mf-border pt-3 sm:grid-cols-12">
            <input
              aria-label={`Description ligne ${index + 1}`} placeholder="Description" value={line.description}
              onChange={(e) => updateLine(index, { description: e.target.value })}
              className="rounded-lg border border-mf-border px-3 py-2 text-sm sm:col-span-4" />
            <input
              aria-label={`Quantite ligne ${index + 1}`} type="number" step="0.001" min="0.001" value={line.quantity}
              onChange={(e) => updateLine(index, { quantity: e.target.value })}
              className="rounded-lg border border-mf-border px-3 py-2 text-sm sm:col-span-1" />
            <input
              aria-label={`Prix unitaire ligne ${index + 1}`} type="number" step="0.01" min="0" value={line.unit_price}
              onChange={(e) => updateLine(index, { unit_price: e.target.value })}
              className="rounded-lg border border-mf-border px-3 py-2 text-sm sm:col-span-2" />
            <select
              aria-label={`Compte de produit ligne ${index + 1}`} value={line.revenue_account_id}
              onChange={(e) => updateLine(index, { revenue_account_id: e.target.value })}
              className="rounded-lg border border-mf-border px-3 py-2 text-sm sm:col-span-3">
              <option value="">— Compte de produit —</option>
              {revenueAccounts.map((a) => (<option key={a.id} value={a.id}>{a.label}</option>))}
            </select>
            <select
              aria-label={`Taxe ligne ${index + 1}`} value={line.tax_rate_id}
              onChange={(e) => updateLine(index, { tax_rate_id: e.target.value })}
              className="rounded-lg border border-mf-border px-3 py-2 text-sm sm:col-span-1">
              <option value="">Sans</option>
              {taxRates.map((t) => (<option key={t.id} value={t.id}>{t.rate_percent}%</option>))}
            </select>
            <button type="button" onClick={() => setLines((p) => p.filter((_, i) => i !== index))}
              disabled={lines.length === 1}
              className="rounded-lg border border-mf-border px-2 py-2 text-xs text-mf-danger disabled:opacity-40 sm:col-span-1">
              Retirer
            </button>
          </div>
        ))}

        <div className="border-t border-mf-border pt-3 text-right text-sm">
          <div>Sous-total : <strong>{formatMoney(totals.subtotal, currency)}</strong></div>
          <div>Taxes : <strong>{formatMoney(totals.tax, currency)}</strong></div>
          <div className="text-base">Total : <strong>{formatMoney(totals.total, currency)}</strong></div>
          <p className="mt-1 text-xs text-slate-400">
            Apercu — les montants definitifs sont recalcules par la base a l&apos;enregistrement.
          </p>
        </div>
      </section>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-mf-danger">{error}</p>
      )}

      <button type="submit" disabled={pending}
        className="rounded-lg bg-mf-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-navy-800 disabled:opacity-60">
        {pending ? 'Enregistrement…' : submitLabel}
      </button>
    </form>
  )
}
