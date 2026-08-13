import type { Metadata } from 'next'
import { getMemberships } from '@/lib/auth/dal'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import { hasPermission } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Accueil — MedFinder Gestion' }

export default async function DirectionPage() {
  const memberships = await getMemberships()
  const activeOrgId = await getActiveOrganizationId()
  const active = memberships.find((m) => m.organization_id === activeOrgId)

  const supabase = await createClient()
  const { count: memberCount } = await supabase
    .from('memberships')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', activeOrgId!)
    .eq('status', 'active')

  const canViewAudit = activeOrgId ? await hasPermission(activeOrgId, 'audit.view') : false

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-mf-navy-900">
          Bienvenue{active ? ` — ${active.organization_name}` : ''}
        </h1>
        <p className="text-sm text-slate-500">
          Socle Phase 1A : organisation, acces, roles et audit. Les modules Finance,
          RH, PAPEJ, Comptabilite, Payroll et CRM arrivent dans les phases suivantes
          (voir docs/roadmap.md).
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <DashboardCard label="Membres actifs" value={String(memberCount ?? 0)} />
        <DashboardCard label="Vos roles" value={active?.role_codes.join(', ') || 'Aucun'} />
        <DashboardCard label="Organisations accessibles" value={String(memberships.length)} />
      </div>

      <div className="rounded-2xl border border-mf-border bg-mf-surface p-6 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-mf-navy-900">Modules a venir</h2>
        <ul className="grid grid-cols-2 gap-2 text-sm text-slate-500 sm:grid-cols-3">
          {[
            'RH & Contrats',
            'Depenses',
            'Tresorerie',
            'Budget',
            'PAPEJ',
            'Dons & Subventions',
            'Comptabilite',
            'Payroll',
            'CRM Terrain',
          ].map((label) => (
            <li key={label} className="rounded-lg bg-slate-50 px-3 py-2">
              {label} <span className="text-xs text-slate-400">— Phase 1B+</span>
            </li>
          ))}
        </ul>
      </div>

      {!canViewAudit && (
        <p className="text-xs text-slate-400">
          Le journal d&apos;audit est visible depuis le menu pour les roles disposant de la
          permission <code>audit.view</code>.
        </p>
      )}
    </div>
  )
}

function DashboardCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-mf-border bg-mf-surface p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-mf-navy-900">{value}</p>
    </div>
  )
}
