import type { Metadata } from 'next'
import Link from 'next/link'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import { hasPermission } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import { AccessDenied } from '@/components/shell/access-denied'
import { StatusBadge } from '@/components/finance/status-badge'
import { CsvExportButton } from '@/components/finance/csv-export-button'
import { formatMoney } from '@/lib/format/money'

export const metadata: Metadata = { title: 'Facturation — MedFinder Gestion' }

const PAGE_SIZE = 25

type PageProps = {
  searchParams: Promise<{
    q?: string
    type?: string
    statut?: string
    du?: string
    au?: string
    page?: string
  }>
}

export default async function FacturationPage({ searchParams }: PageProps) {
  const params = await searchParams
  const orgId = await getActiveOrganizationId()
  if (!orgId) return <AccessDenied />

  const [canManage, canView] = await Promise.all([
    hasPermission(orgId, 'invoice.manage'),
    hasPermission(orgId, 'accounting.view'),
  ])
  if (!canManage && !canView) return <AccessDenied />

  const page = Math.max(1, Number(params.page ?? '1') || 1)
  const from = (page - 1) * PAGE_SIZE
  const search = (params.q ?? '').trim()

  const supabase = await createClient()
  let query = supabase
    .from('invoices')
    .select(
      'id, document_type, document_number, status, document_date, due_date, currency, total, total_htg, amount_paid, balance_due, third_parties ( legal_name )',
      { count: 'exact' }
    )

  if (search) query = query.ilike('document_number', `%${search}%`)
  if (params.type === 'facture') query = query.eq('document_type', 'INVOICE')
  if (params.type === 'avoir') query = query.eq('document_type', 'CREDIT_NOTE')
  if (params.statut) query = query.eq('status', params.statut)
  if (params.du) query = query.gte('document_date', params.du)
  if (params.au) query = query.lte('document_date', params.au)

  const { data: rows, count } = await query
    .order('document_date', { ascending: false })
    .order('created_at', { ascending: false })
    .range(from, from + PAGE_SIZE - 1)

  const total = count ?? 0
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))

  function pageHref(target: number) {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v && k !== 'page') qs.set(k, String(v))
    qs.set('page', String(target))
    return `/facturation?${qs.toString()}`
  }

  const csvRows = (rows ?? []).map((r) => ({
    Numero: r.document_number ?? '(brouillon)',
    Type: r.document_type === 'CREDIT_NOTE' ? 'Avoir' : 'Facture',
    Client: (r.third_parties as { legal_name?: string } | null)?.legal_name ?? '',
    Date: r.document_date,
    Echeance: r.due_date,
    Devise: r.currency,
    Total: String(r.total),
    'Total HTG': String(r.total_htg ?? ''),
    Paye: String(r.amount_paid),
    Restant: String(r.balance_due ?? ''),
    Statut: r.status,
  }))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-mf-navy-900">Facturation</h1>
          <p className="text-sm text-slate-500">
            Factures et avoirs clients. Les montants HTG affiches sont les contre-valeurs historiques figees a l&apos;emission.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CsvExportButton rows={csvRows} filename={`facturation-page-${page}.csv`} />
          {canManage && (
            <Link href="/facturation/nouvelle"
              className="rounded-lg bg-mf-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-navy-800">
              Nouveau document
            </Link>
          )}
        </div>
      </div>

      <form action="/facturation" className="flex flex-wrap items-end gap-3 rounded-2xl border border-mf-border bg-mf-surface p-4 shadow-sm">
        <div>
          <label htmlFor="q" className="block text-xs font-medium text-mf-navy-900">Numero</label>
          <input id="q" name="q" defaultValue={search} placeholder="FAC-2026-…"
            className="mt-1 rounded-lg border border-mf-border px-3 py-2 text-sm" />
        </div>
        <div>
          <label htmlFor="type" className="block text-xs font-medium text-mf-navy-900">Type</label>
          <select id="type" name="type" defaultValue={params.type ?? ''}
            className="mt-1 rounded-lg border border-mf-border px-3 py-2 text-sm">
            <option value="">Tous</option>
            <option value="facture">Factures</option>
            <option value="avoir">Avoirs</option>
          </select>
        </div>
        <div>
          <label htmlFor="statut" className="block text-xs font-medium text-mf-navy-900">Statut</label>
          <select id="statut" name="statut" defaultValue={params.statut ?? ''}
            className="mt-1 rounded-lg border border-mf-border px-3 py-2 text-sm">
            <option value="">Tous</option>
            <option value="draft">Brouillon</option>
            <option value="pending_issue">A emettre</option>
            <option value="issued">Emise</option>
            <option value="partially_paid">Partiellement payee</option>
            <option value="paid">Payee</option>
            <option value="cancelled">Annulee</option>
          </select>
        </div>
        <div>
          <label htmlFor="du" className="block text-xs font-medium text-mf-navy-900">Du</label>
          <input id="du" type="date" name="du" defaultValue={params.du ?? ''}
            className="mt-1 rounded-lg border border-mf-border px-3 py-2 text-sm" />
        </div>
        <div>
          <label htmlFor="au" className="block text-xs font-medium text-mf-navy-900">Au</label>
          <input id="au" type="date" name="au" defaultValue={params.au ?? ''}
            className="mt-1 rounded-lg border border-mf-border px-3 py-2 text-sm" />
        </div>
        <button type="submit"
          className="rounded-lg bg-mf-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-navy-800">
          Filtrer
        </button>
      </form>

      <div className="overflow-x-auto rounded-2xl border border-mf-border bg-mf-surface shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-3 py-2">Numero</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Client</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Echeance</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2 text-right">Paye</th>
              <th className="px-3 py-2 text-right">Restant</th>
              <th className="px-3 py-2">Statut</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((r) => (
              <tr key={r.id} className="border-t border-mf-border hover:bg-slate-50">
                <td className="px-3 py-2">
                  <Link href={`/facturation/${r.id}`} className="font-medium text-mf-navy-700 hover:underline">
                    {r.document_number ?? '(brouillon)'}
                  </Link>
                </td>
                <td className="px-3 py-2 text-xs">{r.document_type === 'CREDIT_NOTE' ? 'Avoir' : 'Facture'}</td>
                <td className="px-3 py-2 text-xs">
                  {(r.third_parties as { legal_name?: string } | null)?.legal_name ?? '—'}
                </td>
                <td className="px-3 py-2 text-xs">{r.document_date}</td>
                <td className="px-3 py-2 text-xs">{r.due_date}</td>
                <td className="px-3 py-2 text-right">
                  {formatMoney(r.total, r.currency)}
                  {r.currency !== 'HTG' && (
                    <div className="text-xs text-slate-400">{formatMoney(r.total_htg ?? 0, 'HTG')}</div>
                  )}
                </td>
                <td className="px-3 py-2 text-right">{formatMoney(r.amount_paid, r.currency)}</td>
                <td className="px-3 py-2 text-right font-medium">{formatMoney(r.balance_due ?? 0, r.currency)}</td>
                <td className="px-3 py-2"><StatusBadge status={r.status} domain="invoice" /></td>
              </tr>
            ))}
            {(rows ?? []).length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-slate-400">
                  Aucun document ne correspond aux filtres.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-slate-500">
        <span>{total} document(s) — page {page} sur {lastPage}</span>
        <div className="flex gap-2">
          {page > 1 && (
            <Link href={pageHref(page - 1)} className="rounded-lg border border-mf-border px-3 py-1.5 hover:bg-slate-50">
              Precedent
            </Link>
          )}
          {page < lastPage && (
            <Link href={pageHref(page + 1)} className="rounded-lg border border-mf-border px-3 py-1.5 hover:bg-slate-50">
              Suivant
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
