import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { signInAs, adminClient, getOrgIdByName } from './helpers'
import { FixtureRegistry, tag } from '../support/fixture-registry'

/**
 * Verification explicite demandee pour la migration 20260816090010 (et son
 * correctif 20260816090012) : 5 assertions precises sur ce qu'un
 * AGENT_TERRAIN (expense.create "propres" seul, jamais budget.view) peut
 * et ne peut pas voir.
 */
describe('Phase 1C-UI — verification migration 090010/090012 (visibilite AGENT_TERRAIN)', () => {
  let orgA: string
  let orgB: string
  const registry = new FixtureRegistry()

  beforeAll(async () => {
    orgA = await getOrgIdByName('MedFinder Demo — Organisation A')
    orgB = await getOrgIdByName('MedFinder Demo — Organisation B')
  })

  afterAll(async () => {
    await registry.cleanup(adminClient())
  })

  async function approvedBudgetLine(label: string) {
    const admin = adminClient()
    const { data: fy } = await admin
      .from('fiscal_years')
      .insert({ organization_id: orgA, label: tag(`verif090010-${label}`), start_date: '2034-01-01', end_date: '2034-12-31' })
      .select('id')
      .single()
    registry.track('fiscal_years', fy!.id as string)

    const { data: budget } = await admin
      .from('budgets')
      .insert({ organization_id: orgA, fiscal_year_id: fy!.id, name: tag(`Budget verif ${label}`), status: 'approved' })
      .select('id')
      .single()
    registry.track('budgets', budget!.id as string)

    const { data: line } = await admin
      .from('budget_lines')
      .insert({ organization_id: orgA, budget_id: budget!.id, category: tag(`Categorie verif ${label}`), planned_amount: 10000 })
      .select('id, category')
      .single()
    registry.track('budget_lines', line!.id as string)

    return { budgetId: budget!.id as string, lineId: line!.id as string, category: line!.category as string }
  }

  async function draftBudgetLine(label: string) {
    const admin = adminClient()
    const { data: fy } = await admin
      .from('fiscal_years')
      .insert({ organization_id: orgA, label: tag(`verifdraft090010-${label}`), start_date: '2034-01-01', end_date: '2034-12-31' })
      .select('id')
      .single()
    registry.track('fiscal_years', fy!.id as string)

    const { data: budget } = await admin
      .from('budgets')
      .insert({ organization_id: orgA, fiscal_year_id: fy!.id, name: tag(`Budget brouillon verif ${label}`) })
      .select('id')
      .single()
    registry.track('budgets', budget!.id as string)

    const { data: line } = await admin
      .from('budget_lines')
      .insert({ organization_id: orgA, budget_id: budget!.id, category: tag(`Categorie brouillon verif ${label}`), planned_amount: 10000 })
      .select('id, category')
      .single()
    registry.track('budget_lines', line!.id as string)

    return { budgetId: budget!.id as string, lineId: line!.id as string, category: line!.category as string }
  }

  it('1. AGENT_TERRAIN peut selectionner les lignes necessaires a sa propre depense (lignes ET budget parent lisibles)', async () => {
    const { budgetId, category } = await approvedBudgetLine(`sel${Date.now()}`)
    const { client } = await signInAs('agent.demo@medfinder.test')

    const { data: lines, error } = await client
      .from('budget_lines')
      .select('id, category, budgets ( name, status )')
      .eq('budget_id', budgetId)
    expect(error).toBeNull()
    expect(lines).toHaveLength(1)
    expect(lines![0].category).toBe(category)
    // La regression trouvee lors de cette verification : budgets etait
    // toujours null (embarquement PostgREST bloque par RLS sur `budgets`)
    // avant le correctif 090012 — verifie explicitement ici.
    expect(lines![0].budgets).not.toBeNull()
    const budgetsField = lines![0].budgets as { status: string } | { status: string }[]
    const embeddedBudget = Array.isArray(budgetsField) ? budgetsField[0] : budgetsField
    expect(embeddedBudget.status).toBe('approved')
  })

  it('2. AGENT_TERRAIN peut consulter sa propre demande de depense', async () => {
    const { lineId } = await approvedBudgetLine(`own${Date.now()}`)
    const { client, userId } = await signInAs('agent.demo@medfinder.test')
    const { data: req, error: insErr } = await client
      .from('expense_requests')
      .insert({
        organization_id: orgA,
        budget_line_id: lineId,
        requester_id: userId,
        payee_name: tag('Fournisseur verif'),
        amount: 100,
        payment_method: 'cash',
      })
      .select('id')
      .single()
    expect(insErr).toBeNull()
    if (req?.id) registry.track('expense_requests', req.id as string)

    const { data: seen, error: selErr } = await client.from('expense_requests').select('id').eq('id', req!.id)
    expect(selErr).toBeNull()
    expect(seen).toHaveLength(1)
  })

  it('3. AGENT_TERRAIN ne voit pas les demandes des autres agents (isolation par requester, pas seulement par organisation)', async () => {
    // Un seul compte AGENT_TERRAIN existe dans le seed — on utilise
    // MANAGER (qui detient aussi expense.create) comme "autre createur",
    // ce qui teste exactement le meme mecanisme d'isolation par
    // requester_id (RLS de expense_requests_select : expense.view OU
    // requester_id = auth.uid(), jamais une ouverture par role ou par
    // organisation seule).
    const { lineId } = await approvedBudgetLine(`others${Date.now()}`)
    const { client: managerClient, userId: managerId } = await signInAs('manager.demo@medfinder.test')
    const { data: otherReq, error: insErr } = await managerClient
      .from('expense_requests')
      .insert({
        organization_id: orgA,
        budget_line_id: lineId,
        requester_id: managerId,
        payee_name: tag('Fournisseur autre createur'),
        amount: 200,
        payment_method: 'cash',
      })
      .select('id')
      .single()
    expect(insErr).toBeNull()
    if (otherReq?.id) registry.track('expense_requests', otherReq.id as string)

    const { client: agentClient } = await signInAs('agent.demo@medfinder.test')
    const { data: seen, error } = await agentClient.from('expense_requests').select('id').eq('id', otherReq!.id)
    expect(error).toBeNull()
    expect(seen ?? []).toHaveLength(0)
  })

  it('4. AGENT_TERRAIN n\'obtient PAS budget.view par effet indirect (la RLS etendue n\'accorde pas la permission elle-meme)', async () => {
    const { client } = await signInAs('agent.demo@medfinder.test')
    const { data } = await client.rpc('current_user_has_permission', {
      p_org_id: orgA,
      p_permission_code: 'budget.view',
    })
    expect(data).toBe(false)
  })

  it('5. AGENT_TERRAIN ne peut pas consulter globalement les lignes/budgets auxquels il n\'a pas droit (budget en brouillon invisible)', async () => {
    const { budgetId, lineId } = await draftBudgetLine(`hidden${Date.now()}`)
    const { client } = await signInAs('agent.demo@medfinder.test')

    const { data: budgetSeen, error: budgetErr } = await client.from('budgets').select('id').eq('id', budgetId)
    expect(budgetErr).toBeNull()
    expect(budgetSeen ?? []).toHaveLength(0)

    const { data: lineSeen, error: lineErr } = await client.from('budget_lines').select('id').eq('id', lineId)
    expect(lineErr).toBeNull()
    expect(lineSeen ?? []).toHaveLength(0)
  })

  it('Complement isolation : un acteur d\'Org B ne voit aucune ligne/budget approuve d\'Org A via cette meme extension', async () => {
    await approvedBudgetLine(`isoB${Date.now()}`)
    const { client } = await signInAs('orgb.demo@medfinder.test')
    const { data: lines } = await client.from('budget_lines').select('id').eq('organization_id', orgA)
    expect(lines ?? []).toHaveLength(0)
    void orgB
  })
})
