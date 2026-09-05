import Link from 'next/link'
import { formatMoney } from '@/lib/format/money'
import { CompositionBar, Eyebrow, Kpi, Panel, PanelSection, SectionHeading } from './dashboard-primitives'

export type DirectionDashboardProps = {
  organizationName?: string
  roleCodes: string[]
  memberCount: number
  organizationCount: number
  canViewAudit: boolean
  canViewAccounting: boolean
  canViewTreasury: boolean
  canViewBudget: boolean
  canViewExpenses: boolean
  canViewPapej: boolean
  hasAnyFinancialWidget: boolean
  treasuryTotalsByCurrency: [string, number][]
  cashTotal: number
  bankTotal: number
  budgetConsumed: number
  budgetAvailable: number
  ledgerExpensesThisMonth: number
  expensesPending: number
  missingJustifications: number
  papejGranted: number
  papejReceived: number
  papejCommitted: number
  papejPaid: number
  papejAvailable: number
}

/** Composition du prototype /apercu/direction, alimentee UNIQUEMENT par la
 * page actuelle. Le prototype ne fournit ni calcul, ni permission, ni donnee.
 */
export function DirectionDashboard({
  organizationName, roleCodes, memberCount, organizationCount,
  canViewAudit, canViewAccounting, canViewTreasury, canViewBudget, canViewExpenses, canViewPapej,
  hasAnyFinancialWidget, treasuryTotalsByCurrency, cashTotal, bankTotal,
  budgetConsumed, budgetAvailable, ledgerExpensesThisMonth, expensesPending, missingJustifications,
  papejGranted, papejReceived, papejCommitted, papejPaid, papejAvailable,
}: DirectionDashboardProps) {
  return (
    <div data-direction-dashboard className="mx-auto w-full min-w-0 max-w-[1440px] space-y-8 [overflow-wrap:anywhere]">
      <section className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <Eyebrow>{organizationName ?? 'Organisation'}</Eyebrow>
          <h1 className="mt-3.5 text-[28px] font-semibold leading-[1.15] tracking-tight text-mf-navy-950 lg:text-4xl">
            Votre organisation en un regard
          </h1>
          <p className="mt-2.5 text-[15px] leading-relaxed text-slate-600">
            Membres, trésorerie, budget et financements à date.
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
            <span className="font-medium">Vos rôles : </span>{roleCodes.join(', ') || 'Aucun'}
          </p>
        </div>
        {canViewAudit && (
          <Link href="/audit" className="inline-flex shrink-0 items-center rounded-lg border border-mf-border bg-mf-surface px-4 py-2.5 text-sm font-medium text-mf-navy-900 transition-colors hover:bg-mf-navy-900/5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-mf-emerald-600">
            Journal d&apos;audit
          </Link>
        )}
      </section>

      <section aria-label="Vue d’ensemble">
        <SectionHeading title="Vue d’ensemble" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Membres actifs" value={String(memberCount)} note="Statut actif" />
          <Kpi label="Organisations accessibles" value={String(organizationCount)} note="Accessibles avec ce compte" />
          {canViewExpenses && (
            <>
              <Kpi label="Depenses a approuver" value={String(expensesPending)} note="Dépenses soumises" tone={expensesPending > 0 ? 'warning' : 'default'} />
              <Kpi label="Justificatifs manquants" value={String(missingJustifications)} note="Dépenses payées sans pièce jointe" tone={missingJustifications > 0 ? 'danger' : 'default'} />
            </>
          )}
        </div>
      </section>

      {canViewTreasury && (
        <PanelSection title="Trésorerie">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {treasuryTotalsByCurrency.map(([currency, total]) => (
              <Kpi key={currency} nested label={`Tresorerie totale (${currency})`} value={formatMoney(total, currency)} note="Comptes actifs" />
            ))}
            <Kpi nested label="Solde caisse" value={formatMoney(cashTotal)} note="Espèces" />
            <Kpi nested label="Solde banque" value={formatMoney(bankTotal)} note="Comptes bancaires" />
          </div>
        </PanelSection>
      )}

      {(canViewAccounting || canViewBudget) && (
        <PanelSection title="Dépenses et budget">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {canViewAccounting && (
              <Kpi nested label="Charges comptabilisees du mois" value={formatMoney(ledgerExpensesThisMonth)}
                note="Écritures comptabilisées — pas un décaissement de trésorerie" />
            )}
            {canViewBudget && (
              <>
                <Kpi nested label="Budget consomme" value={formatMoney(budgetConsumed)} tone="warning" />
                <Kpi nested label="Budget disponible" value={formatMoney(budgetAvailable)} tone="success" />
              </>
            )}
          </div>
          {canViewBudget && <CompositionBar label="Consommation du budget" formatValue={formatMoney}
            segments={[{ label: 'Consommé', amount: budgetConsumed }, { label: 'Disponible', amount: budgetAvailable, positive: true }]} />}
        </PanelSection>
      )}

      {canViewPapej && (
        <PanelSection title="PAPEJ" aside={
          <dl data-direction-kpi="PAPEJ accorde" className="flex flex-wrap gap-x-2">
            <dt>PAPEJ accorde</dt>
            <dd className="font-semibold text-mf-navy-900">{formatMoney(papejGranted)}</dd>
          </dl>
        }>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Kpi nested label="PAPEJ recu" value={formatMoney(papejReceived)} tone="success" />
            <Kpi nested label="PAPEJ engage" value={formatMoney(papejCommitted)} tone="warning" />
            <Kpi nested label="PAPEJ paye" value={formatMoney(papejPaid)} />
            <Kpi nested label="Solde PAPEJ" value={formatMoney(papejAvailable)} tone="success" />
          </div>
          <CompositionBar label="Répartition PAPEJ" formatValue={formatMoney}
            segments={[{ label: 'Payé', amount: papejPaid }, { label: 'Engagé', amount: papejCommitted }, { label: 'Solde', amount: papejAvailable, positive: true }]} />
        </PanelSection>
      )}

      {!hasAnyFinancialWidget && (
        <Panel className="p-6">
          <h2 className="text-sm font-semibold text-mf-navy-900">Modules disponibles</h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-500">
            Les indicateurs financiers (trésorerie, budget, dépenses, PAPEJ) sont visibles depuis le
            menu pour les rôles disposant des permissions correspondantes.
          </p>
        </Panel>
      )}
      {!canViewAudit && (
        <p className="text-[13px] leading-relaxed text-slate-500">
          Le journal d&apos;audit est visible depuis le menu pour les rôles disposant de la
          permission <code className="text-xs">audit.view</code>.
        </p>
      )}
    </div>
  )
}
