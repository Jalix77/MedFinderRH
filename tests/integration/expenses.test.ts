import { describe, it, expect, beforeAll } from 'vitest'
import { signInAs, signInAsElevated, adminClient, getOrgIdByName } from './helpers'

// DIRECTEUR_GENERAL et SUPER_ADMIN exigent AAL2 pour TOUTE permission
// (app_private.user_requires_mfa/is_super_admin, Phase 1A) — quand l'un de
// ces roles doit REUSSIR une action gardee par permission (approuver,
// valider une exception), la session doit d'abord etre elevee via
// signInAsElevated() (cycle TOTP reel), sans quoi has_permission()/
// is_super_admin() renvoient false et l'action echoue a tort.

/**
 * Phase 1C, sous-jalon 1C.4 — Depenses. Couvre le workflow complet
 * (draft->submitted->committed->paid->justified->posted), la separation
 * des fonctions formelle (§7 du plan corrige), l'absence de creation/
 * transition directe hors RPC (§8), et l'absence de double comptage
 * budgetaire une fois un paiement effectue (§4/§13).
 */
describe('Phase 1C.4 — Depenses', () => {
  let orgA: string

  beforeAll(async () => {
    orgA = await getOrgIdByName('MedFinder Demo — Organisation A')
  })

  async function setupExpenseFixtures(orgId: string, plannedAmount: number, label: string) {
    const admin = adminClient()
    const { data: fy } = await admin
      .from('fiscal_years')
      .insert({ organization_id: orgId, label: `EXP-${label}`, start_date: '2031-01-01', end_date: '2031-12-31' })
      .select('id')
      .single()
    const { data: budget } = await admin
      .from('budgets')
      .insert({ organization_id: orgId, fiscal_year_id: fy!.id, name: `Budget ${label}`, status: 'approved' })
      .select('id')
      .single()
    const { data: line } = await admin
      .from('budget_lines')
      .insert({ organization_id: orgId, budget_id: budget!.id, category: `Cat ${label}`, planned_amount: plannedAmount })
      .select('id')
      .single()
    const { data: expenseGlAccount } = await admin
      .from('chart_of_accounts')
      .insert({ organization_id: orgId, code: `EXP-GL-${label}`, label: 'Charge test', type: 'expense' })
      .select('id')
      .single()
    const { data: cashGlAccount } = await admin
      .from('chart_of_accounts')
      .insert({ organization_id: orgId, code: `CASH-GL-${label}`, label: 'Caisse GL test', type: 'asset' })
      .select('id')
      .single()
    const { data: category } = await admin
      .from('expense_categories')
      .insert({ organization_id: orgId, name: `Categorie ${label}`, default_account_id: expenseGlAccount!.id })
      .select('id')
      .single()
    const { data: cashAccount } = await admin
      .from('cash_accounts')
      .insert({ organization_id: orgId, name: `Caisse ${label}`, gl_account_id: cashGlAccount!.id, current_balance: 100000 })
      .select('id')
      .single()
    return {
      budgetLineId: line!.id as string,
      categoryId: category!.id as string,
      cashAccountId: cashAccount!.id as string,
    }
  }

  async function createExpenseRequest(
    client: Awaited<ReturnType<typeof signInAs>>['client'],
    orgId: string,
    requesterId: string,
    budgetLineId: string,
    categoryId: string,
    amount: number
  ) {
    const { data, error } = await client
      .from('expense_requests')
      .insert({
        organization_id: orgId,
        expense_number: '',
        requester_id: requesterId,
        category_id: categoryId,
        budget_line_id: budgetLineId,
        payee_name: 'Fournisseur Test',
        amount,
        payment_method: 'cash',
      })
      .select('id, expense_number')
      .single()
    if (error) throw error
    return data as { id: string; expense_number: string }
  }

  describe('Creation (RLS) et numerotation', () => {
    it('MANAGER (expense.create) peut creer une demande en draft, numero auto-assigne', async () => {
      const { budgetLineId, categoryId } = await setupExpenseFixtures(orgA, 5000, `create${Date.now()}`)
      const { client, userId } = await signInAs('manager.demo@medfinder.test')
      const req = await createExpenseRequest(client, orgA, userId, budgetLineId, categoryId, 500)
      expect(req.expense_number).toMatch(/^DEP-\d{4}-\d{4}$/)
    })

    it('SUPPORT (sans expense.create) ne peut pas creer de demande', async () => {
      const { budgetLineId, categoryId } = await setupExpenseFixtures(orgA, 5000, `nocreate${Date.now()}`)
      const { client, userId } = await signInAs('support.demo@medfinder.test')
      await expect(createExpenseRequest(client, orgA, userId, budgetLineId, categoryId, 500)).rejects.toBeTruthy()
    })

    it('impossible de creer directement une demande a un statut autre que draft', async () => {
      const { budgetLineId, categoryId } = await setupExpenseFixtures(orgA, 5000, `nodirect${Date.now()}`)
      const { client, userId } = await signInAs('manager.demo@medfinder.test')
      const { error } = await client.from('expense_requests').insert({
        organization_id: orgA,
        expense_number: '',
        requester_id: userId,
        category_id: categoryId,
        budget_line_id: budgetLineId,
        payee_name: 'Test',
        amount: 100,
        payment_method: 'cash',
        status: 'paid',
      })
      expect(error).toBeTruthy()
    })

    it("aucun UPDATE direct de expense_requests.status n'est possible (transitions via RPC uniquement)", async () => {
      const { budgetLineId, categoryId } = await setupExpenseFixtures(orgA, 5000, `noupdate${Date.now()}`)
      const { client, userId } = await signInAs('manager.demo@medfinder.test')
      const req = await createExpenseRequest(client, orgA, userId, budgetLineId, categoryId, 500)
      const { error } = await client.from('expense_requests').update({ status: 'submitted' }).eq('id', req.id)
      expect(error).toBeTruthy()
    })
  })

  describe('Workflow complet : soumission -> approbation -> paiement -> justification -> comptabilisation', () => {
    it('parcours nominal de bout en bout, trois acteurs distincts', async () => {
      const { budgetLineId, categoryId, cashAccountId } = await setupExpenseFixtures(orgA, 5000, `flow${Date.now()}`)
      const { client: requesterClient, userId: requesterId } = await signInAs('manager.demo@medfinder.test')
      const req = await createExpenseRequest(requesterClient, orgA, requesterId, budgetLineId, categoryId, 1200)

      const { data: submitResult, error: submitError } = await requesterClient.rpc('submit_expense_request', {
        p_expense_id: req.id,
      })
      expect(submitError).toBeNull()
      expect((submitResult as { success: boolean })?.success).toBe(true)

      const { client: approverClient, deElevate } = await signInAsElevated('dg.demo@medfinder.test')
      try {
        const { data: approveResult, error: approveError } = await approverClient.rpc('approve_expense_request', {
          p_expense_id: req.id,
          p_decision: 'approved',
        })
        expect(approveError).toBeNull()
        expect((approveResult as { success: boolean })?.success).toBe(true)

        const admin = adminClient()
        const { data: afterApproval } = await admin.from('expense_requests').select('status').eq('id', req.id).single()
        expect(afterApproval?.status).toBe('committed')

        const { client: payerClient } = await signInAs('comptable.demo@medfinder.test')
        const { data: payResult, error: payError } = await payerClient.rpc('pay_expense_request', {
          p_expense_id: req.id,
          p_treasury_account_type: 'cash',
          p_treasury_account_id: cashAccountId,
        })
        expect(payError).toBeNull()
        expect((payResult as { success: boolean })?.success).toBe(true)

        const { data: cashAfter } = await admin.from('cash_accounts').select('current_balance').eq('id', cashAccountId).single()
        expect(Number(cashAfter?.current_balance)).toBe(100000 - 1200)

        const { error: attachError } = await requesterClient.from('expense_attachments').insert({
          organization_id: orgA,
          expense_request_id: req.id,
          type: 'facture',
          storage_path: `${orgA}/${req.id}/${Date.now()}-facture.pdf`,
          original_filename: 'facture.pdf',
        })
        expect(attachError).toBeNull()

        const { data: justifyResult, error: justifyError } = await payerClient.rpc('justify_expense_request', {
          p_expense_id: req.id,
        })
        expect(justifyError).toBeNull()
        expect((justifyResult as { success: boolean })?.success).toBe(true)

        const { data: final } = await admin.from('expense_requests').select('status').eq('id', req.id).single()
        expect(final?.status).toBe('posted')

        const { data: journalEntryId } = await admin
          .from('expenses')
          .select('journal_entry_id')
          .eq('expense_request_id', req.id)
          .single()
        const { data: entry } = await admin
          .from('journal_entries')
          .select('status')
          .eq('id', journalEntryId!.journal_entry_id)
          .single()
        expect(entry?.status).toBe('posted')
      } finally {
        await deElevate()
      }
    })

    it('la justification est refusee sans piece jointe', async () => {
      const { budgetLineId, categoryId, cashAccountId } = await setupExpenseFixtures(orgA, 5000, `nojust${Date.now()}`)
      const { client: requesterClient, userId: requesterId } = await signInAs('manager.demo@medfinder.test')
      const req = await createExpenseRequest(requesterClient, orgA, requesterId, budgetLineId, categoryId, 300)
      await requesterClient.rpc('submit_expense_request', { p_expense_id: req.id })
      const { client: approverClient, deElevate } = await signInAsElevated('dg.demo@medfinder.test')
      try {
        await approverClient.rpc('approve_expense_request', { p_expense_id: req.id, p_decision: 'approved' })
        const { client: payerClient } = await signInAs('comptable.demo@medfinder.test')
        await payerClient.rpc('pay_expense_request', {
          p_expense_id: req.id,
          p_treasury_account_type: 'cash',
          p_treasury_account_id: cashAccountId,
        })

        const { data, error } = await payerClient.rpc('justify_expense_request', { p_expense_id: req.id })
        expect(error).toBeNull()
        expect((data as { success: boolean; error: string })?.success).toBe(false)
        expect((data as { success: boolean; error: string })?.error).toBe('no_attachment')
      } finally {
        await deElevate()
      }
    })
  })

  describe('Separation des fonctions', () => {
    it('auto-approbation refusee', async () => {
      const { budgetLineId, categoryId } = await setupExpenseFixtures(orgA, 5000, `selfapp${Date.now()}`)
      const { client, userId } = await signInAs('manager.demo@medfinder.test')
      const req = await createExpenseRequest(client, orgA, userId, budgetLineId, categoryId, 200)
      await client.rpc('submit_expense_request', { p_expense_id: req.id })
      const { data, error } = await client.rpc('approve_expense_request', { p_expense_id: req.id, p_decision: 'approved' })
      expect(error).toBeNull()
      expect((data as { success: boolean; error: string })?.success).toBe(false)
      expect((data as { success: boolean; error: string })?.error).toBe('self_approval_blocked')
    })

    // Note de perimetre : sous la matrice de roles par defaut
    // (docs/permissions-matrix.md), aucun role autre que SUPER_ADMIN ne
    // cumule expense.approve ET expense.pay — le garde-fou
    // "payer_is_approver" de pay_expense_request est donc, par construction,
    // inatteignable pour un role normal ; il protege le scenario ou un
    // override individuel (user_permission_overrides, Phase 1A) accorderait
    // les deux permissions a la meme personne. Le tester correctement
    // exigerait une session authentifiee AAL2 (permission.override impose
    // MFA, cf. tests/integration/mfa-enforcement.test.ts) pour poser un tel
    // override — laisse en dette de test explicite, voir le rapport de
    // cloture Phase 1C plutot que simule superficiellement ici.
  })

  describe('Exception SoD formelle (§7 du plan corrige)', () => {
    it('un non-DG ne peut pas valider une exception', async () => {
      const { budgetLineId, categoryId } = await setupExpenseFixtures(orgA, 5000, `exc1${Date.now()}`)
      const { client: requesterClient, userId: requesterId } = await signInAs('manager.demo@medfinder.test')
      const req = await createExpenseRequest(requesterClient, orgA, requesterId, budgetLineId, categoryId, 400)
      await requesterClient.rpc('submit_expense_request', { p_expense_id: req.id })
      const { error: reqExcError, data: reqExcData } = await requesterClient.rpc('request_expense_approval_exception', {
        p_expense_id: req.id,
        p_justification: 'Aucun autre approbateur disponible (equipe reduite)',
      })
      expect(reqExcError).toBeNull()
      expect((reqExcData as { success: boolean })?.success).toBe(true)

      const { client: comptableClient } = await signInAs('comptable.demo@medfinder.test')
      const { data, error } = await comptableClient.rpc('validate_expense_approval_exception', {
        p_expense_id: req.id,
        p_result: 'approved',
      })
      expect(error).toBeNull()
      expect((data as { success: boolean; error: string })?.success).toBe(false)
      expect((data as { success: boolean; error: string })?.error).toBe('validator_must_be_dg')
    })

    it('le demandeur de l\'exception ne peut jamais la valider lui-meme, meme s\'il est DG', async () => {
      const { budgetLineId, categoryId } = await setupExpenseFixtures(orgA, 5000, `exc2${Date.now()}`)
      const { client: dgClient, userId: dgUserId } = await signInAs('dg.demo@medfinder.test')
      const req = await createExpenseRequest(dgClient, orgA, dgUserId, budgetLineId, categoryId, 400)
      await dgClient.rpc('submit_expense_request', { p_expense_id: req.id })
      await dgClient.rpc('request_expense_approval_exception', {
        p_expense_id: req.id,
        p_justification: 'DG lui-meme, aucun autre DG disponible',
      })

      const { data, error } = await dgClient.rpc('validate_expense_approval_exception', {
        p_expense_id: req.id,
        p_result: 'approved',
      })
      expect(error).toBeNull()
      expect((data as { success: boolean; error: string })?.success).toBe(false)
      expect((data as { success: boolean; error: string })?.error).toBe('self_validation_blocked')
    })

    it('un validateur distinct (SUPER_ADMIN) peut valider l\'exception et l\'engagement budgetaire est cree', async () => {
      const { budgetLineId, categoryId } = await setupExpenseFixtures(orgA, 5000, `exc3${Date.now()}`)
      const { client: dgClient, userId: dgUserId } = await signInAs('dg.demo@medfinder.test')
      const req = await createExpenseRequest(dgClient, orgA, dgUserId, budgetLineId, categoryId, 400)
      await dgClient.rpc('submit_expense_request', { p_expense_id: req.id })
      await dgClient.rpc('request_expense_approval_exception', {
        p_expense_id: req.id,
        p_justification: 'DG lui-meme, aucun autre DG disponible',
      })

      // is_super_admin() exige aussi AAL2 inconditionnellement (Phase 1A).
      const { client: superClient, deElevate } = await signInAsElevated('super.demo@medfinder.test')
      try {
        const { data, error } = await superClient.rpc('validate_expense_approval_exception', {
          p_expense_id: req.id,
          p_result: 'approved',
        })
        expect(error).toBeNull()
        expect((data as { success: boolean })?.success).toBe(true)

        const admin = adminClient()
        const { data: after } = await admin.from('expense_requests').select('status').eq('id', req.id).single()
        expect(after?.status).toBe('committed')
      } finally {
        await deElevate()
      }
    })
  })

  describe('Budget insuffisant', () => {
    it('une approbation qui depasserait le disponible est refusee (engagement non cree)', async () => {
      const { budgetLineId, categoryId } = await setupExpenseFixtures(orgA, 100, `insuff${Date.now()}`)
      const { client: requesterClient, userId: requesterId } = await signInAs('manager.demo@medfinder.test')
      const req = await createExpenseRequest(requesterClient, orgA, requesterId, budgetLineId, categoryId, 500)
      await requesterClient.rpc('submit_expense_request', { p_expense_id: req.id })
      const { client: approverClient, deElevate } = await signInAsElevated('dg.demo@medfinder.test')
      try {
        const { error } = await approverClient.rpc('approve_expense_request', { p_expense_id: req.id, p_decision: 'approved' })
        expect(error).toBeTruthy()

        const admin = adminClient()
        const { data: after } = await admin.from('expense_requests').select('status').eq('id', req.id).single()
        expect(after?.status).toBe('submitted')
      } finally {
        await deElevate()
      }
    })
  })

  describe('Annulation et liberation d\'engagement', () => {
    it('annuler une demande engagee libere le budget (aucun double comptage)', async () => {
      const { budgetLineId, categoryId } = await setupExpenseFixtures(orgA, 1000, `cancel${Date.now()}`)
      const { client: requesterClient, userId: requesterId } = await signInAs('manager.demo@medfinder.test')
      const req = await createExpenseRequest(requesterClient, orgA, requesterId, budgetLineId, categoryId, 600)
      await requesterClient.rpc('submit_expense_request', { p_expense_id: req.id })
      const { client: approverClient, deElevate } = await signInAsElevated('dg.demo@medfinder.test')
      try {
        await approverClient.rpc('approve_expense_request', { p_expense_id: req.id, p_decision: 'approved' })

        const admin = adminClient()
        const { data: committed } = await admin
          .from('budget_line_balances')
          .select('available_amount')
          .eq('budget_line_id', budgetLineId)
          .single()
        expect(Number(committed?.available_amount)).toBe(400)

        const { data, error } = await approverClient.rpc('cancel_expense_request', {
          p_expense_id: req.id,
          p_reason: 'Depense finalement non necessaire',
        })
        expect(error).toBeNull()
        expect((data as { success: boolean })?.success).toBe(true)

        const { data: released } = await admin
          .from('budget_line_balances')
          .select('available_amount')
          .eq('budget_line_id', budgetLineId)
          .single()
        expect(Number(released?.available_amount)).toBe(1000)
      } finally {
        await deElevate()
      }
    })
  })

  describe('Isolation multi-organisation', () => {
    it("un acteur d'Org B ne peut ni voir ni payer une demande d'Org A", async () => {
      const { budgetLineId, categoryId, cashAccountId } = await setupExpenseFixtures(orgA, 5000, `iso${Date.now()}`)
      const { client: requesterClient, userId: requesterId } = await signInAs('manager.demo@medfinder.test')
      const req = await createExpenseRequest(requesterClient, orgA, requesterId, budgetLineId, categoryId, 300)

      const { client: orgBClient } = await signInAs('orgb.demo@medfinder.test')
      const { data: seen } = await orgBClient.from('expense_requests').select('id').eq('id', req.id)
      expect(seen ?? []).toEqual([])

      const { data: payResult, error } = await orgBClient.rpc('pay_expense_request', {
        p_expense_id: req.id,
        p_treasury_account_type: 'cash',
        p_treasury_account_id: cashAccountId,
      })
      expect(error).toBeNull()
      expect((payResult as { success: boolean; error: string })?.success).toBe(false)
    })
  })
})
