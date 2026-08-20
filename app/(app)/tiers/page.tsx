import type { Metadata } from 'next'
import Link from 'next/link'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import { hasPermission } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import { AccessDenied } from '@/components/shell/access-denied'
import { StatusBadge } from '@/components/finance/status-badge'

export const metadata: Metadata = { title: 'Tiers — MedFinder Gestion' }

const PAGE_SIZE = 25

type PageProps = {
  searchParams: Promise<{ q?: string; role?: string; actif?: string; page?: string }>
}

export default async function TiersPage({ searchParams }: PageProps) {
  const params = await searchParams
  const orgId = await getActiveOrganizationId()
  if (!orgId) return <AccessDenied />

  // Permissions existantes uniquement — aucune nouvelle permission.
  const [canCustomer, canSupplier] = await Promise.all([
    hasPermission(orgId, 'customer.manage'),
    hasPermission(orgId, 'supplier.manage'),
  ])
  if (!canCustomer && !canSupplier) return <AccessDenied />

  const page = Math.max(1, Number(params.page ?? '1') || 1)
  const from = (page - 1) * PAGE_SIZE
  const search = (params.q ?? '').trim()

  const supabase = await createClient()
  let query = supabase
    .from('third_parties')
    .select('id, third_party_code, legal_name, commercial_name, tax_id, is_customer, is_supplier, is_active, preferred_currency', {
      count: 'exact',
    })

  if (search) {
    query = query.or(
      `legal_name.ilike.%${search}%,commercial_name.ilike.%${search}%,third_party_code.ilike.%${search}%,tax_id.ilike.%${search}%`
    )
  }
  if (params.role === 'client') query = query.eq('is_customer', true)
  if (params.role === 'fournisseur') query = query.eq('is_supplier', true)
  if (params.actif === 'oui') query = query.eq('is_active', true)
  if (params.actif === 'non') query = query.eq('is_active', false)

  const { data: rows, count } = await query
    .order('legal_name')
    .range(from, from + PAGE_SIZE - 1)

  const total = count ?? 0
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))

  function pageHref(target: number) {
    const qs = new URLSearchParams()
    if (search) qs.set('q', search)
    if (params.role) qs.set('role', params.role)
    if (params.actif) qs.set('actif', params.actif)
    qs.set('page', String(target))
    return `/tiers?${qs.toString()}`
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-mf-navy-900">Tiers</h1>
          <p className="text-sm text-slate-500">
            Referentiel unique clients et fournisseurs — un meme tiers peut porter les deux roles.
          </p>
        </div>
        <Link href="/tiers/nouveau"
          className="rounded-lg bg-mf-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-navy-800">
          Nouveau tiers
        </Link>
      </div>

      <form action="/tiers" className="flex flex-wrap items-end gap-3 rounded-2xl border border-mf-border bg-mf-surface p-4 shadow-sm">
        <div>
          <label htmlFor="q" className="block text-xs font-medium text-mf-navy-900">Recherche</label>
          <input id="q" name="q" defaultValue={search} placeholder="Nom, code, NIF"
            className="mt-1 rounded-lg border border-mf-border px-3 py-2 text-sm" />
        </div>
        <div>
          <label htmlFor="role" className="block text-xs font-medium text-mf-navy-900">Role</label>
          <select id="role" name="role" defaultValue={params.role ?? ''}
            className="mt-1 rounded-lg border border-mf-border px-3 py-2 text-sm">
            <option value="">Tous</option>
            <option value="client">Clients</option>
            <option value="fournisseur">Fournisseurs</option>
          </select>
        </div>
        <div>
          <label htmlFor="actif" className="block text-xs font-medium text-mf-navy-900">Statut</label>
          <select id="actif" name="actif" defaultValue={params.actif ?? ''}
            className="mt-1 rounded-lg border border-mf-border px-3 py-2 text-sm">
            <option value="">Tous</option>
            <option value="oui">Actifs</option>
            <option value="non">Inactifs</option>
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
              <th className="px-3 py-2">Code</th>
              <th className="px-3 py-2">Raison sociale</th>
              <th className="px-3 py-2">NIF</th>
              <th className="px-3 py-2">Roles</th>
              <th className="px-3 py-2">Devise</th>
              <th className="px-3 py-2">Statut</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((r) => (
              <tr key={r.id} className="border-t border-mf-border hover:bg-slate-50">
                <td className="px-3 py-2 font-mono text-xs">{r.third_party_code}</td>
                <td className="px-3 py-2">
                  <Link href={`/tiers/${r.id}`} className="font-medium text-mf-navy-700 hover:underline">
                    {r.legal_name}
                  </Link>
                  {r.commercial_name && <span className="ml-2 text-xs text-slate-400">{r.commercial_name}</span>}
                </td>
                <td className="px-3 py-2 text-xs">{r.tax_id ?? '—'}</td>
                <td className="px-3 py-2 text-xs">
                  {[r.is_customer ? 'Client' : null, r.is_supplier ? 'Fournisseur' : null].filter(Boolean).join(' + ')}
                </td>
                <td className="px-3 py-2 text-xs">{r.preferred_currency}</td>
                <td className="px-3 py-2">
                  <StatusBadge status={r.is_active ? 'active' : 'inactive'} />
                </td>
              </tr>
            ))}
            {(rows ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                  Aucun tiers ne correspond aux filtres.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-slate-500">
        <span>{total} tiers — page {page} sur {lastPage}</span>
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
