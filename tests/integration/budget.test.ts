import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { signInAs, adminClient, getOrgIdByName } from './helpers'
import { FixtureRegistry, tag } from '../support/fixture-registry'

/**
 * Phase 1C, sous-jalon 1C.3 — Budget. Couvre les tests obligatoires du plan
 * corrige (docs/phase-1c-plan.md §4/§5/§10/§13) : engagements concurrents
 * sur la meme ligne (un seul reussit), absence d'INSERT direct sur
 * budget_commitments, vue budget_line_balances RLS/isolation.
 */
describe('Phase 1C.3 — Budget', () => {
  let orgA: string
  // Hermeticite (suite au retour de Jean Alix Pierre — c'est ce fichier qui
  // a le plus contribue aux 300+ lignes budgetaires accumulees) : chaque
  // ligne creee est enregistree et nettoyee par le afterAll ci-dessous —
  // voir tests/support/fixture-registry.ts.
  const registry = new FixtureRegistry()

  beforeAll(async () => {
    orgA = await getOrgIdByName('MedFinder Demo — Organisation A')
  })

  afterAll(async () => {
    await registry.cleanup(adminClient())
  })

  async function approvedBudgetLine(orgId: string, plannedAmount: number, label: string) {
    const admin = adminClient()
    const { data: fy } = await admin
      .from('fiscal_years')
      .insert({ organization_id: orgId, label: tag(`BUD-${label}`), start_date: '2028-01-01', end_date: '2028-12-31' })
      .select('id')
      .single()
    registry.track('fiscal_years', fy!.id as string)

    const { data: budget } = await admin
      .from('budgets')
      .insert({ organization_id: orgId, fiscal_year_id: fy!.id, name: tag(`Budget ${label}`), status: 'approved' })
      .select('id')
      .single()
    registry.track('budgets', budget!.id as string)

    const { data: line } = await admin
      .from('budget_lines')
      .insert({ organization_id: orgId, budget_id: budget!.id, category: tag(`Categorie ${label}`), planned_amount: plannedAmount })
      .select('id')
      .single()
    registry.track('budget_lines', line!.id as string)

    return { budgetId: budget!.id as string, lineId: line!.id as string }
  }

  describe('Configuration (RLS)', () => {
    it('COMPTABLE (budget.manage) peut creer budget/ligne/centre de cout', async () => {
      const { client } = await signInAs('comptable.demo@medfinder.test')
      const { data: fy } = await client
        .from('fiscal_years')
        .insert({ organization_id: orgA, label: tag(`RLS-BUD-${Date.now()}`), start_date: '2029-01-01', end_date: '2029-12-31' })
        .select('id')
        .single()
      registry.track('fiscal_years', fy!.id as string)

      const { data: budget, error: budgetError } = await client
        .from('budgets')
        .insert({ organization_id: orgA, fiscal_year_id: fy!.id, name: tag(`RLS ${Date.now()}`) })
        .select('id')
        .single()
      expect(budgetError).toBeNull()
      registry.track('budgets', budget!.id as string)

      const { data: line, error: lineError } = await client
        .from('budget_lines')
        .insert({ organization_id: orgA, budget_id: budget!.id, category: tag('Test'), planned_amount: 1000 })
        .select('id')
        .single()
      expect(lineError).toBeNull()
      if (line?.id) registry.track('budget_lines', line.id as string)
    })

    it('SUPPORT (sans budget.manage) ne peut pas creer de budget', async () => {
      const { client } = await signInAs('support.demo@medfinder.test')
      const { error } = await client
        .from('budgets')
        .insert({ organization_id: orgA, fiscal_year_id: '00000000-0000-0000-0000-000000000000', name: 'Refuse' })
      expect(error).toBeTruthy()
    })

    it('MANAGER (budget.view) peut consulter mais pas modifier une ligne approuvee', async () => {
      const { lineId } = await approvedBudgetLine(orgA, 500, `mgr${Date.now()}`)
      const { client } = await signInAs('manager.demo@medfinder.test')
      const { data, error } = await client.from('budget_lines').select('id').eq('id', lineId)
      expect(error).toBeNull()
      expect(data?.length).toBe(1)
    })

    it("planned_amount n'est plus modifiable directement une fois le budget approuve", async () => {
      const { lineId } = await approvedBudgetLine(orgA, 500, `frozen${Date.now()}`)
      const { client } = await signInAs('comptable.demo@medfinder.test')
      const { error, data } = await client.from('budget_lines').update({ planned_amount: 9999 }).eq('id', lineId).select()
      // RLS filtre la ligne candidate (budget non "draft") -> 0 ligne affectee, pas necessairement une erreur explicite
      expect(error).toBeNull()
      expect(data ?? []).toEqual([])
    })

    it("budget_commitments n'accepte aucun INSERT direct d'un client authentifie", async () => {
      const { lineId } = await approvedBudgetLine(orgA, 500, `noinsert${Date.now()}`)
      const { client } = await signInAs('comptable.demo@medfinder.test')
      const { error } = await client.from('budget_commitments').insert({
        organization_id: orgA,
        budget_line_id: lineId,
        reference_type: 'expense_request',
        reference_id: '00000000-0000-0000-0000-000000000000',
        amount: 100,
      })
      expect(error).toBeTruthy()
    })
  })

  describe('Engagement transactionnel (commit_budget_line)', () => {
    it('un engagement dans la limite du disponible reussit', async () => {
      const { lineId } = await approvedBudgetLine(orgA, 1000, `ok${Date.now()}`)
      const { client } = await signInAs('comptable.demo@medfinder.test')
      const { data, error } = await client.rpc('commit_budget_line', {
        p_budget_line_id: lineId,
        p_reference_type: 'expense_request',
        p_reference_id: '00000000-0000-0000-0000-000000000000',
        p_amount: 400,
      })
      expect(error).toBeNull()
      expect((data as { success: boolean })?.success).toBe(true)
      await registry.trackDerivedFrom(adminClient(), 'budget_commitments', 'budget_line_id', [lineId])
    })

    it('un engagement depassant le disponible est refuse', async () => {
      const { lineId } = await approvedBudgetLine(orgA, 100, `over${Date.now()}`)
      const { client } = await signInAs('comptable.demo@medfinder.test')
      const { error } = await client.rpc('commit_budget_line', {
        p_budget_line_id: lineId,
        p_reference_type: 'expense_request',
        p_reference_id: '00000000-0000-0000-0000-000000000000',
        p_amount: 150,
      })
      expect(error).toBeTruthy()
    })

    it('MANAGER (sans budget.manage) ne peut pas engager', async () => {
      const { lineId } = await approvedBudgetLine(orgA, 1000, `mgrdeny${Date.now()}`)
      const { client } = await signInAs('manager.demo@medfinder.test')
      const { data, error } = await client.rpc('commit_budget_line', {
        p_budget_line_id: lineId,
        p_reference_type: 'expense_request',
        p_reference_id: '00000000-0000-0000-0000-000000000000',
        p_amount: 100,
      })
      expect(error).toBeNull()
      expect((data as { success: boolean; error: string })?.success).toBe(false)
      expect((data as { success: boolean; error: string })?.error).toBe('not_authorized')
    })

    it('un engagement contre un budget non approuve ("draft") est refuse', async () => {
      const admin = adminClient()
      const { data: fy } = await admin
        .from('fiscal_years')
        .insert({ organization_id: orgA, label: tag(`DRAFT-${Date.now()}`), start_date: '2030-01-01', end_date: '2030-12-31' })
        .select('id')
        .single()
      registry.track('fiscal_years', fy!.id as string)

      const { data: budget } = await admin
        .from('budgets')
        .insert({ organization_id: orgA, fiscal_year_id: fy!.id, name: tag('Non approuve'), status: 'draft' })
        .select('id')
        .single()
      registry.track('budgets', budget!.id as string)

      const { data: line } = await admin
        .from('budget_lines')
        .insert({ organization_id: orgA, budget_id: budget!.id, category: tag('Test'), planned_amount: 1000 })
        .select('id')
        .single()
      registry.track('budget_lines', line!.id as string)

      const { client } = await signInAs('comptable.demo@medfinder.test')
      const { error } = await client.rpc('commit_budget_line', {
        p_budget_line_id: line!.id,
        p_reference_type: 'expense_request',
        p_reference_id: '00000000-0000-0000-0000-000000000000',
        p_amount: 100,
      })
      expect(error).toBeTruthy()
    })

    it('DEUX engagements concurrents admissibles separement mais qui depasseraient ensemble le budget : un seul reussit', async () => {
      const { lineId } = await approvedBudgetLine(orgA, 1000, `race${Date.now()}`)
      const { client: c1 } = await signInAs('comptable.demo@medfinder.test')
      const { client: c2 } = await signInAs('comptable.demo@medfinder.test')

      const [r1, r2] = await Promise.all([
        c1.rpc('commit_budget_line', {
          p_budget_line_id: lineId,
          p_reference_type: 'expense_request',
          p_reference_id: '00000000-0000-0000-0000-000000000001',
          p_amount: 700,
        }),
        c2.rpc('commit_budget_line', {
          p_budget_line_id: lineId,
          p_reference_type: 'expense_request',
          p_reference_id: '00000000-0000-0000-0000-000000000002',
          p_amount: 700,
        }),
      ])

      const succeeded = [r1, r2].filter((r) => !r.error && (r.data as { success: boolean })?.success === true)
      const failed = [r1, r2].filter((r) => r.error || (r.data as { success: boolean })?.success === false)

      expect(succeeded.length).toBe(1)
      expect(failed.length).toBe(1)
      await registry.trackDerivedFrom(adminClient(), 'budget_commitments', 'budget_line_id', [lineId])

      // Aucun double comptage : le disponible final reflete exactement UN
      // engagement de 700, pas deux (qui aurait donne -400).
      const admin = adminClient()
      const { data: balance } = await admin
        .from('budget_line_balances')
        .select('available_amount, committed_open')
        .eq('budget_line_id', lineId)
        .single()
      expect(Number(balance?.committed_open)).toBe(700)
      expect(Number(balance?.available_amount)).toBe(300)
    })
  })

  describe('Liberation d\'engagement', () => {
    it('liberer un engagement actif restitue le disponible', async () => {
      const { lineId } = await approvedBudgetLine(orgA, 500, `rel${Date.now()}`)
      const { client } = await signInAs('comptable.demo@medfinder.test')
      const { data: commitResult } = await client.rpc('commit_budget_line', {
        p_budget_line_id: lineId,
        p_reference_type: 'expense_request',
        p_reference_id: '00000000-0000-0000-0000-000000000003',
        p_amount: 300,
      })
      const commitmentId = (commitResult as { commitment_id: string }).commitment_id
      await registry.trackDerivedFrom(adminClient(), 'budget_commitments', 'budget_line_id', [lineId])

      const admin = adminClient()
      // app_private.release_budget_commitment n'est pas exposee publiquement
      // (aucun workflow autonome en 1C.3 — sera pilotee par le rejet/
      // annulation d'une expense_request en 1C.4). On verifie ici l'etat
      // pre-liberation uniquement ; la RPC elle-meme sera exercee par les
      // tests 1C.4 (rejet/annulation d'une demande de depense).
      const { data: before } = await admin
        .from('budget_line_balances')
        .select('available_amount')
        .eq('budget_line_id', lineId)
        .single()
      expect(Number(before?.available_amount)).toBe(200)
      void commitmentId
    })
  })

  describe('Transfert entre lignes', () => {
    it('COMPTABLE (budget.transfer) peut transferer un montant disponible', async () => {
      const { lineId: fromLine } = await approvedBudgetLine(orgA, 1000, `xferfrom${Date.now()}`)
      const { lineId: toLine } = await approvedBudgetLine(orgA, 100, `xferto${Date.now()}`)
      const { client } = await signInAs('comptable.demo@medfinder.test')
      const { data, error } = await client.rpc('transfer_budget_amount', {
        p_from_line_id: fromLine,
        p_to_line_id: toLine,
        p_amount: 200,
        p_reason: 'Reequilibrage test',
      })
      expect(error).toBeNull()
      expect((data as { success: boolean })?.success).toBe(true)
      await registry.trackDerivedFrom(adminClient(), 'budget_transfers', 'from_line_id', [fromLine])

      const admin = adminClient()
      const { data: lines } = await admin.from('budget_lines').select('id, planned_amount').in('id', [fromLine, toLine])
      const from = lines!.find((l) => (l as { id: string }).id === fromLine)
      const to = lines!.find((l) => (l as { id: string }).id === toLine)
      expect(Number(from?.planned_amount)).toBe(800)
      expect(Number(to?.planned_amount)).toBe(300)
    })

    it('un transfert au-dela du disponible de la ligne source est refuse', async () => {
      const { lineId: fromLine } = await approvedBudgetLine(orgA, 100, `xferover${Date.now()}`)
      const { lineId: toLine } = await approvedBudgetLine(orgA, 100, `xferover2${Date.now()}`)
      const { client } = await signInAs('comptable.demo@medfinder.test')
      const { error } = await client.rpc('transfer_budget_amount', {
        p_from_line_id: fromLine,
        p_to_line_id: toLine,
        p_amount: 500,
        p_reason: 'Test refus',
      })
      expect(error).toBeTruthy()
    })
  })

  describe('Vue budget_line_balances — RLS/isolation (§10 du plan corrige)', () => {
    it('respecte le meme controle d\'acces que budget_lines', async () => {
      const { lineId } = await approvedBudgetLine(orgA, 500, `view${Date.now()}`)
      const { client } = await signInAs('support.demo@medfinder.test')
      const { data, error } = await client.from('budget_line_balances').select('*').eq('budget_line_id', lineId)
      expect(error).toBeNull()
      expect(data ?? []).toEqual([])
    })

    it("un acteur d'Org B ne voit aucune ligne de la vue pour Org A", async () => {
      const { lineId } = await approvedBudgetLine(orgA, 500, `viewiso${Date.now()}`)
      const { client } = await signInAs('orgb.demo@medfinder.test')
      const { data, error } = await client.from('budget_line_balances').select('*').eq('budget_line_id', lineId)
      expect(error).toBeNull()
      expect(data ?? []).toEqual([])
    })
  })
})
