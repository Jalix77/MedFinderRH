import type { Metadata } from 'next'
import Link from 'next/link'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import { hasPermission } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import { AccessDenied } from '@/components/shell/access-denied'
import { StatusBadge } from '@/components/finance/status-badge'
import { formatMoney } from '@/lib/format/money'

export const metadata: Metadata = { title: 'Rapprochement — MedFinder Gestion' }

const PAGE_SIZE = 20

type PageProps = {
  searchParams: Promise<{ q?: string; statut?: string; compte?: string; page?: string }>
}

export default async function RapprochementPage({ searchParams }: PageProps) {
  const params = await searchParams
  const orgId = await getActiveOrganizationId()
  if (!orgId) return <AccessDenied />

  const [canReconcile, canManage, canView] = await Promise.all([
    hasPermission(orgId, 'treasury.reconcile'),
    hasPermission(orgId, 'treasury.manage'),
    hasPermission(orgId, 'accounting.view'),
  ])
  if (!canReconcile && !canManage && !canView) return <AccessDenied />

  const page = Math.max(1, Number(params.page ?? '1') || 1)
  const from = (page - 1) * PAGE_SIZE
  const search = (params.q ?? '').trim()

  const supabase = await createClient()
  let query = supabase
    .from('bank_statement_imports')
    .select(
      'id, treasury_account_type, treasury_account_id, statement_reference, period_start, period_end, currency, closing_balance_statement, line_count, status, imported_at',
      { count: 'exact' }
    )

  if (search) query = query.ilike('statement_reference', `%${search}%`)
  if (params.statut) query = query.eq('status', params.statut)
  if (params.compte) query = query.eq('treasury_account_type', params.compte)

  const { data: rows, count } = await query
    .order('imported_at', { ascending: false })
    .range(from, from + PAGE_SIZE - 1)

  const total = count ?? 0
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))

  function pageHref(target: number) {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v && k !== 'page') qs.set(k, String(v))
    qs.set('page', String(target))
    return `/tresorerie/rapprochement?${qs.toString()}`
  }

  const ACCOUNT_LABELS: Record<string, string> = {
    cash: 'Caisse',
    bank: 'Banque',
    mobile_money: 'Mobile money',
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-mf-navy-900">Rapprochement de tresorerie</h1>
          <p className="text-sm text-slate-500">
            Compare les releves externes aux mouvements deja enregistres. Aucune ecriture comptable
            n&apos;est generee par le rapprochement.{' '}
            <Link href="/tresorerie" className="text-mf-navy-700 hover:underline">Retour a la tresorerie</Link>
          </p>
        </div>
        {(canReconcile || canManage) && (
          <Link href="/tresorerie/rapprochement/importer"
            className="rounded-lg bg-mf-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-navy-800">
            Importer un releve
          </Link>
        )}
      </div>

      <form action="/tresorerie/rapprochement"
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-mf-border bg-mf-surface p-4 shadow-sm">
        <div>
          <label htmlFor="q" className="block text-xs font-medium text-mf-navy-900">Reference</label>
          <input id="q" name="q" defaultValue={search} placeholder="Releve mars…"
            className="mt-1 rounded-lg border border-mf-border px-3 py-2 text-sm" />
        </div>
        <div>
          <label htmlFor="compte" className="block text-xs font-medium text-mf-navy-900">Type de compte</label>
          <select id="compte" name="compte" defaultValue={params.compte ?? ''}
            className="mt-1 rounded-lg border border-mf-border px-3 py-2 text-sm">
            <option value="">Tous</option>
            <option value="cash">Caisse</option>
            <option value="bank">Banque</option>
            <option value="mobile_money">Mobile money</option>
          </select>
        </div>
        <div>
          <label htmlFor="statut" className="block text-xs font-medium text-mf-navy-900">Statut</label>
          <select id="statut" name="statut" defaultValue={params.statut ?? ''}
            className="mt-1 rounded-lg border border-mf-border px-3 py-2 text-sm">
            <option value="">Tous</option>
            <option value="imported">Importe</option>
            <option value="cancelled">Annule</option>
          </select>
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
              <th className="px-3 py-2">Reference</th>
              <th className="px-3 py-2">Compte</th>
              <th className="px-3 py-2">Periode</th>
              <th className="px-3 py-2 text-right">Lignes</th>
              <th className="px-3 py-2 text-right">Solde releve</th>
              <th className="px-3 py-2">Statut</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((r) => (
              <tr key={r.id} className="border-t border-mf-border hover:bg-slate-50">
                <td className="px-3 py-2">
                  <Link href={`/tresorerie/rapprochement/${r.id}`}
                    className="font-medium text-mf-navy-700 hover:underline">
                    {r.statement_reference}
                  </Link>
                </td>
                <td className="px-3 py-2 text-xs">{ACCOUNT_LABELS[r.treasury_account_type] ?? r.treasury_account_type}</td>
                <td className="px-3 py-2 text-xs">{r.period_start} → {r.period_end}</td>
                <td className="px-3 py-2 text-right">{r.line_count}</td>
                <td className="px-3 py-2 text-right">
                  {formatMoney(r.closing_balance_statement, r.currency)}
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={r.status === 'imported' ? 'active' : 'cancelled'} domain="invoice" />
                </td>
              </tr>
            ))}
            {(rows ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                  Aucun releve importe ne correspond aux filtres.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-slate-500">
        <span>{total} releve(s) — page {page} sur {lastPage}</span>
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
