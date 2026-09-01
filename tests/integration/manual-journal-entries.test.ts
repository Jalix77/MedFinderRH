import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { signInAs, signInAsElevated, adminClient, getOrgIdByName } from './helpers'
import { FixtureRegistry, tag } from '../support/fixture-registry'

/**
 * Phase 2A — Ecritures manuelles avec separation saisie/validation
 * obligatoire (docs/phase-2-plan.md §0.3/2A, decision actee par Jean Alix
 * Pierre le 17/08/2026). Workflow : Draft -> Submitted ->
 * Approved/Rejected -> Posted -> Reversed. Couvre : creation (refus <2
 * lignes, refus sans accounting.post), auto-approbation refusee, chemin
 * nominal approbation -> posting (chemin "approved" nouvellement accepte
 * par app_private.post_journal_entry), rejet, exception SoD formelle
 * (mirror exact du mecanisme deja prouve sur les depenses en 1C.4),
 * isolation multi-organisation, immutabilite d'un compte utilise.
 */
describe('Phase 2A — Ecritures manuelles (separation saisie/validation)', () => {
  let orgA: string
  const registry = new FixtureRegistry()

  beforeAll(async () => {
    orgA = await getOrgIdByName('MedFinder Demo — Organisation A')
  })

  afterAll(async () => {
    await registry.cleanup(adminClient())
  })

  async function setupFixtures(label: string) {
    const admin = adminClient()
    const { data: fy } = await admin
      .from('fiscal_years')
      .insert({ organization_id: orgA, label: tag(label), start_date: '2026-01-01', end_date: '2026-12-31' })
      .select('id')
      .single()
    registry.track('fiscal_years', fy!.id as string)

    const currentMonth = new Date().getMonth() + 1
    const { data: period } = await admin
      .from('accounting_periods')
      .insert({ organization_id: orgA, fiscal_year_id: fy!.id, month: currentMonth })
      .select('id')
      .single()
    registry.track('accounting_periods', period!.id as string)

    const { data: debitAccount } = await admin
      .from('chart_of_accounts')
      .insert({ organization_id: orgA, code: `MD-${label}`, label: tag('Compte debit manuel'), type: 'expense' })
      .select('id')
      .single()
    registry.track('chart_of_accounts', debitAccount!.id as string)

    const { data: creditAccount } = await admin
      .from('chart_of_accounts')
      .insert({ organization_id: orgA, code: `MC-${label}`, label: tag('Compte credit manuel'), type: 'asset' })
      .select('id')
      .single()
    registry.track('chart_of_accounts', creditAccount!.id as string)

    return { debitAccountId: debitAccount!.id as string, creditAccountId: creditAccount!.id as string }
  }

  describe('Creation (RLS/RPC)', () => {
    it('COMPTABLE (accounting.post) peut creer un brouillon manuel a 2 lignes', async () => {
      const ctx = await setupFixtures(`create${Date.now()}`)
      const { client } = await signInAs('comptable.demo@medfinder.test')
      const { data, error } = await client.rpc('create_manual_journal_entry', {
        p_org_id: orgA,
        p_journal_code: 'MISC',
        p_entry_date: new Date().toISOString().slice(0, 10),
        p_description: tag('Ecriture manuelle test'),
        p_lines: [
          { account_id: ctx.debitAccountId, debit: 150, credit: 0 },
          { account_id: ctx.creditAccountId, debit: 0, credit: 150 },
        ],
      })
      expect(error).toBeNull()
      expect((data as { success: boolean })?.success).toBe(true)
      const entryId = (data as { entry_id: string }).entry_id
      expect(entryId).toBeTruthy()
      registry.track('journal_entries', entryId)
      await registry.trackDerivedFrom(adminClient(), 'journal_entry_lines', 'entry_id', [entryId])

      const admin = adminClient()
      const { data: after } = await admin.from('journal_entries').select('status, source_type').eq('id', entryId).single()
      expect(after?.status).toBe('draft')
      expect(after?.source_type).toBe('manual')
    })

    it('creation refusee avec moins de 2 lignes', async () => {
      const ctx = await setupFixtures(`1line${Date.now()}`)
      const { client } = await signInAs('comptable.demo@medfinder.test')
      const { error } = await client.rpc('create_manual_journal_entry', {
        p_org_id: orgA,
        p_journal_code: 'MISC',
        p_entry_date: new Date().toISOString().slice(0, 10),
        p_description: tag('Ecriture invalide'),
        p_lines: [{ account_id: ctx.debitAccountId, debit: 100, credit: 0 }],
      })
      expect(error).toBeTruthy()
    })

    it('MANAGER (sans accounting.post) ne peut pas creer d\'ecriture manuelle', async () => {
      const ctx = await setupFixtures(`noauth${Date.now()}`)
      const { client } = await signInAs('manager.demo@medfinder.test')
      const { data, error } = await client.rpc('create_manual_journal_entry', {
        p_org_id: orgA,
        p_journal_code: 'MISC',
        p_entry_date: new Date().toISOString().slice(0, 10),
        p_description: 'Refuse',
        p_lines: [
          { account_id: ctx.debitAccountId, debit: 50, credit: 0 },
          { account_id: ctx.creditAccountId, debit: 0, credit: 50 },
        ],
      })
      expect(error).toBeNull()
      expect((data as { success: boolean; error: string })?.success).toBe(false)
      expect((data as { success: boolean; error: string })?.error).toBe('not_authorized')
    })
  })

  async function createAndSubmit(client: Awaited<ReturnType<typeof signInAs>>['client'], ctx: { debitAccountId: string; creditAccountId: string }, amount: number) {
    const { data } = await client.rpc('create_manual_journal_entry', {
      p_org_id: orgA,
      p_journal_code: 'MISC',
      p_entry_date: new Date().toISOString().slice(0, 10),
      p_description: tag('Ecriture workflow'),
      p_lines: [
        { account_id: ctx.debitAccountId, debit: amount, credit: 0 },
        { account_id: ctx.creditAccountId, debit: 0, credit: amount },
      ],
    })
    const entryId = (data as { entry_id: string }).entry_id
    registry.track('journal_entries', entryId)
    await registry.trackDerivedFrom(adminClient(), 'journal_entry_lines', 'entry_id', [entryId])
    const { data: submitData, error: submitError } = await client.rpc('submit_manual_journal_entry', { p_entry_id: entryId })
    expect(submitError).toBeNull()
    expect((submitData as { success: boolean })?.success).toBe(true)
    return entryId
  }

  describe('Workflow Submitted -> Approved/Rejected -> Posted', () => {
    // Trouvaille reelle (verification navigateur, pas relecture de code,
    // 17/08/2026) : app_private.post_journal_entry acceptait tout brouillon
    // en statut 'draft' sans distinguer automatique/manuel — un COMPTABLE
    // pouvait comptabiliser directement une ecriture manuelle fraichement
    // creee, contournant entierement Soumission -> Approbation. Corrige par
    // la migration 20260818090003 (exige 'approved' pour source_type=
    // 'manual', jamais 'draft'). Ce test verrouille le correctif contre
    // toute regression future.
    it('un brouillon manuel ne peut pas etre comptabilise directement (workflow SoD non contournable)', async () => {
      const ctx = await setupFixtures(`nobypass${Date.now()}`)
      const { client } = await signInAs('comptable.demo@medfinder.test')
      const { data } = await client.rpc('create_manual_journal_entry', {
        p_org_id: orgA,
        p_journal_code: 'MISC',
        p_entry_date: new Date().toISOString().slice(0, 10),
        p_description: tag('Ecriture non soumise'),
        p_lines: [
          { account_id: ctx.debitAccountId, debit: 40, credit: 0 },
          { account_id: ctx.creditAccountId, debit: 0, credit: 40 },
        ],
      })
      const entryId = (data as { entry_id: string }).entry_id
      registry.track('journal_entries', entryId)
      await registry.trackDerivedFrom(adminClient(), 'journal_entry_lines', 'entry_id', [entryId])

      const { error: postError } = await client.rpc('post_journal_entry', { p_entry_id: entryId })
      expect(postError).toBeTruthy()

      const admin = adminClient()
      const { data: after } = await admin.from('journal_entries').select('status').eq('id', entryId).single()
      expect(after?.status).toBe('draft')
    })

    it('soumission : draft -> submitted', async () => {
      const ctx = await setupFixtures(`submit${Date.now()}`)
      const { client } = await signInAs('comptable.demo@medfinder.test')
      const entryId = await createAndSubmit(client, ctx, 80)
      const admin = adminClient()
      const { data } = await admin.from('journal_entries').select('status').eq('id', entryId).single()
      expect(data?.status).toBe('submitted')
    })

    it('auto-approbation refusee (le createur ne peut pas valider sa propre ecriture)', async () => {
      const ctx = await setupFixtures(`selfapp${Date.now()}`)
      const { client } = await signInAs('comptable.demo@medfinder.test')
      const entryId = await createAndSubmit(client, ctx, 120)
      const { data, error } = await client.rpc('approve_manual_journal_entry', { p_entry_id: entryId, p_decision: 'approved' })
      expect(error).toBeNull()
      expect((data as { success: boolean; error: string })?.success).toBe(false)
      expect((data as { success: boolean; error: string })?.error).toBe('self_approval_blocked')

      const admin = adminClient()
      const { data: after } = await admin.from('journal_entries').select('status').eq('id', entryId).single()
      expect(after?.status).toBe('submitted')
    })

    it('un validateur distinct approuve, puis la comptabilisation (chemin "approved") reussit', async () => {
      const ctx = await setupFixtures(`nominal${Date.now()}`)
      const { client: creator } = await signInAs('comptable.demo@medfinder.test')
      const entryId = await createAndSubmit(creator, ctx, 200)

      const { client: approver, deElevate } = await signInAsElevated('super.demo@medfinder.test')
      try {
        const { data, error } = await approver.rpc('approve_manual_journal_entry', { p_entry_id: entryId, p_decision: 'approved' })
        expect(error).toBeNull()
        expect((data as { success: boolean })?.success).toBe(true)
      } finally {
        await deElevate()
      }

      const admin = adminClient()
      const { data: approved } = await admin.from('journal_entries').select('status').eq('id', entryId).single()
      expect(approved?.status).toBe('approved')

      // post_journal_entry accepte desormais aussi 'approved' (elargissement
      // 2A) — chemin nouveau, jamais emprunte par les ecritures automatiques.
      const { data: postData, error: postError } = await creator.rpc('post_journal_entry', { p_entry_id: entryId })
      expect(postError).toBeNull()
      expect((postData as { success: boolean })?.success).toBe(true)

      const { data: posted } = await admin.from('journal_entries').select('status, posted_by').eq('id', entryId).single()
      expect(posted?.status).toBe('posted')
      expect(posted?.posted_by).toBeTruthy()
    })

    it('rejet : submitted -> rejected, jamais postable ensuite', async () => {
      const ctx = await setupFixtures(`reject${Date.now()}`)
      const { client: creator } = await signInAs('comptable.demo@medfinder.test')
      const entryId = await createAndSubmit(creator, ctx, 60)

      const { client: approver, deElevate } = await signInAsElevated('super.demo@medfinder.test')
      try {
        const { data, error } = await approver.rpc('approve_manual_journal_entry', { p_entry_id: entryId, p_decision: 'rejected' })
        expect(error).toBeNull()
        expect((data as { success: boolean })?.success).toBe(true)
      } finally {
        await deElevate()
      }

      const admin = adminClient()
      const { data: rejected } = await admin.from('journal_entries').select('status').eq('id', entryId).single()
      expect(rejected?.status).toBe('rejected')

      const { error: postError } = await creator.rpc('post_journal_entry', { p_entry_id: entryId })
      expect(postError).toBeTruthy()
    })

    it('contre-passation d\'une ecriture manuelle postee fonctionne (RPC deja generique, inchangee)', async () => {
      const ctx = await setupFixtures(`rev${Date.now()}`)
      const { client: creator } = await signInAs('comptable.demo@medfinder.test')
      const entryId = await createAndSubmit(creator, ctx, 300)

      const { client: approver, deElevate } = await signInAsElevated('super.demo@medfinder.test')
      try {
        await approver.rpc('approve_manual_journal_entry', { p_entry_id: entryId, p_decision: 'approved' })
      } finally {
        await deElevate()
      }
      await creator.rpc('post_journal_entry', { p_entry_id: entryId })

      const { data: reverseResult, error: reverseError } = await creator.rpc('reverse_journal_entry', {
        p_entry_id: entryId,
        p_reason: 'Test contre-passation ecriture manuelle',
      })
      expect(reverseError).toBeNull()
      expect((reverseResult as { success: boolean })?.success).toBe(true)
      const reversalId = (reverseResult as { reversal_entry_id: string }).reversal_entry_id
      registry.track('journal_entries', reversalId)
      await registry.trackDerivedFrom(adminClient(), 'journal_entry_lines', 'entry_id', [reversalId])

      const admin = adminClient()
      const { data: reversal } = await admin.from('journal_entries').select('status, reversed_entry_id').eq('id', reversalId).single()
      expect(reversal?.status).toBe('posted')
      expect(reversal?.reversed_entry_id).toBe(entryId)
    })
  })

  describe('Exception SoD formelle (mirror exact du mecanisme depenses 1C.4)', () => {
    it('un non-DG ne peut pas valider une exception', async () => {
      const ctx = await setupFixtures(`exc1${Date.now()}`)
      const { client: creator } = await signInAs('comptable.demo@medfinder.test')
      const entryId = await createAndSubmit(creator, ctx, 90)

      const { data: reqData, error: reqError } = await creator.rpc('request_manual_entry_approval_exception', {
        p_entry_id: entryId,
        p_justification: 'Aucun autre approbateur disponible (equipe reduite)',
      })
      expect(reqError).toBeNull()
      expect((reqData as { success: boolean })?.success).toBe(true)

      const { client: manager } = await signInAs('manager.demo@medfinder.test')
      const { data, error } = await manager.rpc('validate_manual_entry_approval_exception', {
        p_entry_id: entryId,
        p_result: 'approved',
      })
      expect(error).toBeNull()
      expect((data as { success: boolean; error: string })?.success).toBe(false)
      expect((data as { success: boolean; error: string })?.error).toBe('validator_must_be_dg')
    })

    // Note de perimetre (comme §320-330 de expenses.test.ts pour
    // payer_is_approver) : sous la matrice de roles par defaut,
    // DIRECTEUR_GENERAL n'a pas accounting.post — DG ne peut donc jamais
    // etre le createur d'une ecriture manuelle, contrairement aux depenses
    // ou DG a expense.create. Le cas "demandeur = validateur potentiel"
    // n'est donc atteignable ici que via SUPER_ADMIN (qui, lui, cumule
    // accounting.post et l'autorite de validation via is_super_admin()) —
    // toujours un test reel du garde-fou (la verification exception_requested_by
    // = actor s'applique independamment de la voie d'autorite empruntee),
    // pas une simulation superficielle.
    it('le demandeur d\'une exception ne peut jamais la valider lui-meme, meme SUPER_ADMIN', async () => {
      const ctx = await setupFixtures(`exc2${Date.now()}`)
      const { client: superClient, deElevate } = await signInAsElevated('super.demo@medfinder.test')
      try {
        const entryId = await createAndSubmit(superClient, ctx, 90)
        await superClient.rpc('request_manual_entry_approval_exception', {
          p_entry_id: entryId,
          p_justification: 'SUPER_ADMIN lui-meme, aucun autre validateur disponible',
        })

        const { data, error } = await superClient.rpc('validate_manual_entry_approval_exception', {
          p_entry_id: entryId,
          p_result: 'approved',
        })
        expect(error).toBeNull()
        expect((data as { success: boolean; error: string })?.success).toBe(false)
        expect((data as { success: boolean; error: string })?.error).toBe('self_validation_blocked')
      } finally {
        await deElevate()
      }
    })

    it('un validateur DG distinct peut valider l\'exception, l\'ecriture passe a "approved"', async () => {
      const ctx = await setupFixtures(`exc3${Date.now()}`)
      const { client: creator } = await signInAs('comptable.demo@medfinder.test')
      const entryId = await createAndSubmit(creator, ctx, 90)
      await creator.rpc('request_manual_entry_approval_exception', {
        p_entry_id: entryId,
        p_justification: 'Comptable seul disponible, validation DG requise',
      })

      const { client: dgClient, deElevate } = await signInAsElevated('dg.demo@medfinder.test')
      try {
        const { data, error } = await dgClient.rpc('validate_manual_entry_approval_exception', {
          p_entry_id: entryId,
          p_result: 'approved',
        })
        expect(error).toBeNull()
        expect((data as { success: boolean })?.success).toBe(true)
      } finally {
        await deElevate()
      }

      const admin = adminClient()
      const { data: after } = await admin.from('journal_entries').select('status').eq('id', entryId).single()
      expect(after?.status).toBe('approved')
    })

    // Parcours reel signale en exploitation : le createur est aussi le seul
    // approbateur possible, il demande l'exception approver_is_creator, et un
    // SUPER_ADMIN distinct la valide. On verifie la chaine ENTIERE jusqu'a la
    // comptabilisation — c'est elle qui compte pour l'operateur, pas le seul
    // passage a "approved".
    it('createur = approbateur : exception validee par un SUPER_ADMIN distinct, puis ecriture comptabilisee', async () => {
      const ctx = await setupFixtures(`excsa${Date.now()}`)
      const { client: creator, userId: creatorId } = await signInAs('comptable.demo@medfinder.test')
      const entryId = await createAndSubmit(creator, ctx, 90)

      // Le blocage strict s'applique bien AVANT toute exception.
      const { data: blocked } = await creator.rpc('approve_manual_journal_entry', {
        p_entry_id: entryId,
        p_decision: 'approved',
      })
      expect((blocked as { success: boolean; error: string })?.success).toBe(false)
      expect((blocked as { success: boolean; error: string })?.error).toBe('self_approval_blocked')

      const { data: reqData, error: reqError } = await creator.rpc('request_manual_entry_approval_exception', {
        p_entry_id: entryId,
        p_justification: tag('Comptable seul approbateur disponible'),
      })
      expect(reqError).toBeNull()
      expect((reqData as { success: boolean })?.success).toBe(true)

      const { client: superClient, userId: superId, deElevate } = await signInAsElevated('super.demo@medfinder.test')
      expect(superId, 'le validateur doit etre distinct du demandeur').not.toBe(creatorId)
      try {
        const { data, error } = await superClient.rpc('validate_manual_entry_approval_exception', {
          p_entry_id: entryId,
          p_result: 'approved',
        })
        expect(error).toBeNull()
        expect((data as { success: boolean; error?: string })?.success, JSON.stringify(data)).toBe(true)

        // L'ecriture est approuvee, puis comptabilisee.
        const { data: posted, error: postError } = await superClient.rpc('post_journal_entry', {
          p_entry_id: entryId,
        })
        expect(postError).toBeNull()
        expect((posted as { success: boolean; error?: string })?.success, JSON.stringify(posted)).toBe(true)
      } finally {
        await deElevate()
      }

      const admin = adminClient()
      const { data: final } = await admin
        .from('journal_entries')
        .select('status')
        .eq('id', entryId)
        .single()
      expect(final?.status).toBe('posted')

      // La trace de l'exception est conservee et attribuee.
      const { data: approval } = await admin
        .from('journal_entry_approvals')
        .select('exception_requested_by, exception_validated_by, exception_result')
        .eq('entry_id', entryId)
        .not('exception_requested_by', 'is', null)
        .single()
      expect(approval?.exception_requested_by).toBe(creatorId)
      expect(approval?.exception_validated_by).toBe(superId)
      expect(approval?.exception_result).toBe('approved')
    })
  })

  describe('Isolation multi-organisation', () => {
    it('un acteur d\'Org B ne peut ni voir ni approuver une ecriture manuelle d\'Org A', async () => {
      const ctx = await setupFixtures(`iso${Date.now()}`)
      const { client: creator } = await signInAs('comptable.demo@medfinder.test')
      const entryId = await createAndSubmit(creator, ctx, 45)

      const { client: orgBClient } = await signInAs('orgb.demo@medfinder.test')
      const { data: seen } = await orgBClient.from('journal_entries').select('id').eq('id', entryId)
      expect(seen ?? []).toEqual([])

      const { data, error } = await orgBClient.rpc('approve_manual_journal_entry', { p_entry_id: entryId, p_decision: 'approved' })
      expect(error).toBeNull()
      expect((data as { success: boolean; error: string })?.success).toBe(false)
      expect((data as { success: boolean; error: string })?.error).toBe('not_authorized')
    })
  })

  describe('Plan comptable — immutabilite d\'un compte utilise (§0.5 du plan Phase 2)', () => {
    it('un compte reference par une ligne d\'ecriture ne peut pas etre supprime, meme via service_role', async () => {
      const ctx = await setupFixtures(`immused${Date.now()}`)
      const { client: creator } = await signInAs('comptable.demo@medfinder.test')
      const entryId = await createAndSubmit(creator, ctx, 25)
      const { client: approver, deElevate } = await signInAsElevated('super.demo@medfinder.test')
      try {
        await approver.rpc('approve_manual_journal_entry', { p_entry_id: entryId, p_decision: 'approved' })
      } finally {
        await deElevate()
      }
      await creator.rpc('post_journal_entry', { p_entry_id: entryId })

      const admin = adminClient()
      const { error } = await admin.from('chart_of_accounts').delete().eq('id', ctx.debitAccountId)
      expect(error).toBeTruthy()
    })

    it('un compte jamais utilise reste supprimable via service_role', async () => {
      const admin = adminClient()
      const { data: unused } = await admin
        .from('chart_of_accounts')
        .insert({ organization_id: orgA, code: `UNUSED-${Date.now()}`, label: tag('Compte jamais utilise'), type: 'expense' })
        .select('id')
        .single()
      const { error } = await admin.from('chart_of_accounts').delete().eq('id', unused!.id)
      expect(error).toBeNull()
    })
  })
})
