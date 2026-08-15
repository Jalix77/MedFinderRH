import { describe, it, expect, beforeAll } from 'vitest'
import { signInAs, signInAsElevated, adminClient, getOrgIdByName } from './helpers'

/**
 * Phase 1C, sous-jalon 1C.5 — PAPEJ. Couvre le financement en base (montant
 * accorde vs recu distincts, §9 du plan corrige), la reutilisation du
 * moteur budgetaire deja durci (1C.3/1C.4), le rapport, et l'isolation
 * multi-organisation.
 */
describe('Phase 1C.5 — PAPEJ', () => {
  let orgA: string

  beforeAll(async () => {
    orgA = await getOrgIdByName('MedFinder Demo — Organisation A')
  })

  async function setupGrantFixtures(orgId: string, label: string) {
    const admin = adminClient()
    const { data: fy } = await admin
      .from('fiscal_years')
      .insert({ organization_id: orgId, label: `PAPEJ-${label}`, start_date: '2032-01-01', end_date: '2032-12-31' })
      .select('id')
      .single()
    void fy
    const { data: revenueAccount } = await admin
      .from('chart_of_accounts')
      .insert({ organization_id: orgId, code: `REV-GL-${label}`, label: 'Produit PAPEJ test', type: 'revenue' })
      .select('id')
      .single()
    const { data: cashGl } = await admin
      .from('chart_of_accounts')
      .insert({ organization_id: orgId, code: `PAPEJ-CASH-GL-${label}`, label: 'Caisse PAPEJ test', type: 'asset' })
      .select('id')
      .single()
    const { data: cashAccount } = await admin
      .from('cash_accounts')
      .insert({ organization_id: orgId, name: `Caisse PAPEJ ${label}`, gl_account_id: cashGl!.id, current_balance: 0 })
      .select('id')
      .single()
    const { data: grant } = await admin
      .from('grants')
      .insert({
        organization_id: orgId,
        name: `PAPEJ ${label}`,
        donor_name: 'Bailleur Test',
        amount_granted: 850000,
        revenue_account_id: revenueAccount!.id,
      })
      .select('id')
      .single()
    return { grantId: grant!.id as string, cashAccountId: cashAccount!.id as string }
  }

  describe('Financement (RLS + montant accorde/recu distincts)', () => {
    it('COMPTABLE (papej.manage) peut creer un financement, recu initialise a 0', async () => {
      const { client } = await signInAs('comptable.demo@medfinder.test')
      const { data: revenueAccount } = await adminClient()
        .from('chart_of_accounts')
        .insert({ organization_id: orgA, code: `REV-RLS-${Date.now()}`, label: 'Produit', type: 'revenue' })
        .select('id')
        .single()
      const { data, error } = await client
        .from('grants')
        .insert({ organization_id: orgA, name: `RLS-${Date.now()}`, amount_granted: 850000, revenue_account_id: revenueAccount!.id })
        .select('amount_granted, amount_received')
        .single()
      expect(error).toBeNull()
      expect(Number(data?.amount_granted)).toBe(850000)
      expect(Number(data?.amount_received)).toBe(0)
    })

    it('MANAGER (sans papej.manage) ne peut pas creer de financement', async () => {
      const { client } = await signInAs('manager.demo@medfinder.test')
      const { error } = await client
        .from('grants')
        .insert({ organization_id: orgA, name: `Refuse-${Date.now()}`, amount_granted: 100000 })
      expect(error).toBeTruthy()
    })

    it("amount_received n'est pas modifiable par un UPDATE direct (colonne exclue du grant)", async () => {
      const { grantId } = await setupGrantFixtures(orgA, `direct${Date.now()}`)
      const { client } = await signInAs('comptable.demo@medfinder.test')
      const { error } = await client.from('grants').update({ amount_received: 999999 }).eq('id', grantId)
      expect(error).toBeTruthy()
    })

    it('un financement ne peut pas etre cree avec un amount_received non nul', async () => {
      const { client } = await signInAs('comptable.demo@medfinder.test')
      const { error } = await client
        .from('grants')
        .insert({ organization_id: orgA, name: `Hack-${Date.now()}`, amount_granted: 100000, amount_received: 50000 })
      expect(error).toBeTruthy()
    })
  })

  describe('Reception de financement (record_grant_receipt)', () => {
    it('reception met a jour amount_received, le solde de tresorerie et cree une ecriture comptable postee', async () => {
      const { grantId, cashAccountId } = await setupGrantFixtures(orgA, `recv${Date.now()}`)
      const { client } = await signInAs('comptable.demo@medfinder.test')
      const { data, error } = await client.rpc('record_grant_receipt', {
        p_grant_id: grantId,
        p_amount: 300000,
        p_received_date: '2032-02-01',
        p_treasury_account_type: 'cash',
        p_treasury_account_id: cashAccountId,
      })
      expect(error).toBeNull()
      expect((data as { success: boolean })?.success).toBe(true)

      const admin = adminClient()
      const { data: grant } = await admin.from('grants').select('amount_granted, amount_received').eq('id', grantId).single()
      expect(Number(grant?.amount_granted)).toBe(850000)
      expect(Number(grant?.amount_received)).toBe(300000)

      const { data: cash } = await admin.from('cash_accounts').select('current_balance').eq('id', cashAccountId).single()
      expect(Number(cash?.current_balance)).toBe(300000)

      const entryId = (data as { journal_entry_id: string }).journal_entry_id
      const { data: entry } = await admin.from('journal_entries').select('status').eq('id', entryId).single()
      expect(entry?.status).toBe('posted')
    })

    it('deux receptions cumulent amount_received sans ecraser amount_granted', async () => {
      const { grantId, cashAccountId } = await setupGrantFixtures(orgA, `cumul${Date.now()}`)
      const { client } = await signInAs('comptable.demo@medfinder.test')
      await client.rpc('record_grant_receipt', {
        p_grant_id: grantId, p_amount: 200000, p_received_date: '2032-03-01',
        p_treasury_account_type: 'cash', p_treasury_account_id: cashAccountId,
      })
      await client.rpc('record_grant_receipt', {
        p_grant_id: grantId, p_amount: 150000, p_received_date: '2032-04-01',
        p_treasury_account_type: 'cash', p_treasury_account_id: cashAccountId,
      })
      const admin = adminClient()
      const { data: grant } = await admin.from('grants').select('amount_granted, amount_received').eq('id', grantId).single()
      expect(Number(grant?.amount_received)).toBe(350000)
      expect(Number(grant?.amount_granted)).toBe(850000)
    })

    it('MANAGER (sans papej.manage) ne peut pas enregistrer une reception', async () => {
      const { grantId, cashAccountId } = await setupGrantFixtures(orgA, `nomgr${Date.now()}`)
      const { client } = await signInAs('manager.demo@medfinder.test')
      const { data, error } = await client.rpc('record_grant_receipt', {
        p_grant_id: grantId, p_amount: 1000, p_received_date: '2032-05-01',
        p_treasury_account_type: 'cash', p_treasury_account_id: cashAccountId,
      })
      expect(error).toBeNull()
      expect((data as { success: boolean; error: string })?.success).toBe(false)
      expect((data as { success: boolean; error: string })?.error).toBe('not_authorized')
    })
  })

  describe('Lignes budgetaires PAPEJ (reutilisation du moteur budget)', () => {
    it('create_grant_budget_line cree budget+ligne+lien atomiquement, reutilisable par commit_budget_line', async () => {
      const { grantId } = await setupGrantFixtures(orgA, `line${Date.now()}`)
      const { client } = await signInAs('comptable.demo@medfinder.test')
      const { data, error } = await client.rpc('create_grant_budget_line', {
        p_grant_id: grantId,
        p_category: 'Formation jeunes',
        p_planned_amount: 100000,
      })
      expect(error).toBeNull()
      expect((data as { success: boolean })?.success).toBe(true)
      const budgetLineId = (data as { budget_line_id: string }).budget_line_id

      // Le moteur d'engagement generique (1C.3, deja teste pour la
      // concurrence) s'applique sans modification a une ligne PAPEJ.
      const { data: commitResult, error: commitError } = await client.rpc('commit_budget_line', {
        p_budget_line_id: budgetLineId,
        p_reference_type: 'expense_request',
        p_reference_id: '00000000-0000-0000-0000-000000000099',
        p_amount: 40000,
      })
      expect(commitError).toBeNull()
      expect((commitResult as { success: boolean })?.success).toBe(true)

      const admin = adminClient()
      const { data: balance } = await admin
        .from('budget_line_balances')
        .select('available_amount')
        .eq('budget_line_id', budgetLineId)
        .single()
      expect(Number(balance?.available_amount)).toBe(60000)
    })
  })

  describe('Rapport PAPEJ', () => {
    it('COMPTABLE (papej.report) genere un rapport reflétant les lignes et l\'absence de double comptage', async () => {
      const { grantId } = await setupGrantFixtures(orgA, `report${Date.now()}`)
      const { client } = await signInAs('comptable.demo@medfinder.test')
      const { data: lineResult } = await client.rpc('create_grant_budget_line', {
        p_grant_id: grantId,
        p_category: 'Materiel',
        p_planned_amount: 50000,
      })
      const budgetLineId = (lineResult as { budget_line_id: string }).budget_line_id

      const { client: requesterClient, userId: requesterId } = await signInAs('manager.demo@medfinder.test')
      const { data: expReq } = await requesterClient
        .from('expense_requests')
        .insert({
          organization_id: orgA,
          expense_number: '',
          requester_id: requesterId,
          budget_line_id: budgetLineId,
          payee_name: 'Fournisseur PAPEJ',
          amount: 20000,
          payment_method: 'cash',
        })
        .select('id')
        .single()
      await requesterClient.rpc('submit_expense_request', { p_expense_id: expReq!.id })
      // DIRECTEUR_GENERAL exige AAL2 pour toute permission (Phase 1A).
      const { client: approverClient, deElevate } = await signInAsElevated('dg.demo@medfinder.test')
      try {
        await approverClient.rpc('approve_expense_request', { p_expense_id: expReq!.id, p_decision: 'approved' })

        const { data: reportResult, error } = await client.rpc('generate_papej_report', {
          p_grant_id: grantId,
          p_period_start: '2032-01-01',
          p_period_end: '2032-12-31',
        })
        expect(error).toBeNull()
        expect((reportResult as { success: boolean })?.success).toBe(true)
        const report = (reportResult as { report: { lines: Array<{ category: string; planned_amount: number; committed_open: number; available_amount: number }> } }).report
        const line = report.lines.find((l) => l.category === 'Materiel')
        expect(line).toBeTruthy()
        expect(Number(line!.planned_amount)).toBe(50000)
        expect(Number(line!.committed_open)).toBe(20000)
        expect(Number(line!.available_amount)).toBe(30000)
      } finally {
        await deElevate()
      }
    })

    it('MANAGER (sans papej.report) ne peut pas generer de rapport', async () => {
      const { grantId } = await setupGrantFixtures(orgA, `noreport${Date.now()}`)
      const { client } = await signInAs('manager.demo@medfinder.test')
      const { data, error } = await client.rpc('generate_papej_report', {
        p_grant_id: grantId, p_period_start: '2032-01-01', p_period_end: '2032-12-31',
      })
      expect(error).toBeNull()
      expect((data as { success: boolean; error: string })?.success).toBe(false)
      expect((data as { success: boolean; error: string })?.error).toBe('not_authorized')
    })
  })

  describe('Isolation multi-organisation', () => {
    it("un acteur d'Org B ne voit aucune ligne PAPEJ d'Org A et ne peut pas y recevoir de fonds", async () => {
      const { grantId, cashAccountId } = await setupGrantFixtures(orgA, `iso${Date.now()}`)
      const { client } = await signInAs('orgb.demo@medfinder.test')
      const { data: seen } = await client.from('grants').select('id').eq('id', grantId)
      expect(seen ?? []).toEqual([])

      const { data, error } = await client.rpc('record_grant_receipt', {
        p_grant_id: grantId, p_amount: 1000, p_received_date: '2032-06-01',
        p_treasury_account_type: 'cash', p_treasury_account_id: cashAccountId,
      })
      expect(error).toBeNull()
      expect((data as { success: boolean; error: string })?.success).toBe(false)
    })
  })
})
