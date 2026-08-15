import { describe, it, expect, beforeAll } from 'vitest'
import { signInAs, adminClient, getOrgIdByName } from './helpers'

/**
 * Phase 1C, sous-jalon 1C.1 — Comptabilite minimale. Couvre les tests
 * obligatoires du plan corrige (docs/phase-1c-plan.md §6/§7/§13) : brouillon
 * desequilibre autorise, posting desequilibre refuse, posting equilibre
 * accepte, immutabilite post-POSTED (ligne et ecriture), periode fermee
 * bloque le posting, aucune reouverture silencieuse, contre-passation
 * laissant l'originale intacte, isolation multi-organisation.
 */
describe('Phase 1C.1 — Comptabilite minimale', () => {
  let orgA: string
  let orgB: string

  beforeAll(async () => {
    orgA = await getOrgIdByName('MedFinder Demo — Organisation A')
    orgB = await getOrgIdByName('MedFinder Demo — Organisation B')
  })

  async function setupAccountsAndPeriod(orgId: string, label: string) {
    const admin = adminClient()
    const { data: fy } = await admin
      .from('fiscal_years')
      .insert({ organization_id: orgId, label, start_date: '2026-01-01', end_date: '2026-12-31' })
      .select('id')
      .single()
    const { data: period } = await admin
      .from('accounting_periods')
      .insert({ organization_id: orgId, fiscal_year_id: fy!.id, month: 6 })
      .select('id')
      .single()
    const { data: debitAccount } = await admin
      .from('chart_of_accounts')
      .insert({ organization_id: orgId, code: `D-${label}`, label: 'Compte debit test', type: 'expense' })
      .select('id')
      .single()
    const { data: creditAccount } = await admin
      .from('chart_of_accounts')
      .insert({ organization_id: orgId, code: `C-${label}`, label: 'Compte credit test', type: 'asset' })
      .select('id')
      .single()
    const { data: journal } = await admin
      .from('journals')
      .select('id')
      .eq('organization_id', orgId)
      .eq('code', 'MISC')
      .single()
    return {
      fiscalYearId: fy!.id as string,
      periodId: period!.id as string,
      debitAccountId: debitAccount!.id as string,
      creditAccountId: creditAccount!.id as string,
      journalId: journal!.id as string,
    }
  }

  async function insertDraftEntry(
    orgId: string,
    journalId: string,
    periodId: string,
    lines: { accountId: string; debit: number; credit: number }[]
  ) {
    const admin = adminClient()
    const { data: entry, error: entryError } = await admin
      .from('journal_entries')
      .insert({
        organization_id: orgId,
        journal_id: journalId,
        period_id: periodId,
        entry_number: `TEST-JE-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        entry_date: '2026-06-15',
        source_type: 'manual',
        status: 'draft',
      })
      .select('id')
      .single()
    if (entryError) throw entryError
    for (const line of lines) {
      const { error: lineError } = await admin.from('journal_entry_lines').insert({
        organization_id: orgId,
        entry_id: entry!.id,
        account_id: line.accountId,
        debit: line.debit,
        credit: line.credit,
      })
      if (lineError) throw lineError
    }
    return entry!.id as string
  }

  describe('Configuration comptable (RLS)', () => {
    it('COMPTABLE (accounting.post) peut creer un exercice/plan comptable/periode', async () => {
      const { client } = await signInAs('comptable.demo@medfinder.test')
      const { data, error } = await client
        .from('fiscal_years')
        .insert({ organization_id: orgA, label: `RLS-${Date.now()}`, start_date: '2027-01-01', end_date: '2027-12-31' })
        .select('id')
        .single()
      expect(error).toBeNull()
      expect(data?.id).toBeTruthy()
    })

    it('MANAGER (sans accounting.post) ne peut pas creer d\'exercice comptable', async () => {
      const { client } = await signInAs('manager.demo@medfinder.test')
      const { error } = await client
        .from('fiscal_years')
        .insert({ organization_id: orgA, label: `Refuse-${Date.now()}`, start_date: '2027-01-01', end_date: '2027-12-31' })
      expect(error).toBeTruthy()
    })

    it('MANAGER (sans accounting.view) ne voit aucun journal', async () => {
      const { client } = await signInAs('manager.demo@medfinder.test')
      const { data, error } = await client.from('journals').select('id').eq('organization_id', orgA)
      expect(error).toBeNull()
      expect((data ?? []).length).toBe(0)
    })

    it('les 6 journaux standards sont auto-seedes pour l\'organisation', async () => {
      const { client } = await signInAs('comptable.demo@medfinder.test')
      const { data, error } = await client.from('journals').select('code').eq('organization_id', orgA)
      expect(error).toBeNull()
      const codes = (data ?? []).map((j) => (j as { code: string }).code).sort()
      expect(codes).toEqual(['BANK', 'CASH', 'MISC', 'PAYROLL', 'PURCHASES', 'SALES'])
    })
  })

  describe('Posting — invariant verifie au moment atomique (pas ligne par ligne)', () => {
    it('un brouillon desequilibre est autorise (construction en cours)', async () => {
      const ctx = await setupAccountsAndPeriod(orgA, `bal${Date.now()}`)
      await expect(
        insertDraftEntry(orgA, ctx.journalId, ctx.periodId, [
          { accountId: ctx.debitAccountId, debit: 100, credit: 0 },
          { accountId: ctx.creditAccountId, debit: 0, credit: 40 },
        ])
      ).resolves.toBeTruthy()
    })

    it('le posting d\'une ecriture desequilibree est refuse', async () => {
      const ctx = await setupAccountsAndPeriod(orgA, `unb${Date.now()}`)
      const entryId = await insertDraftEntry(orgA, ctx.journalId, ctx.periodId, [
        { accountId: ctx.debitAccountId, debit: 100, credit: 0 },
        { accountId: ctx.creditAccountId, debit: 0, credit: 40 },
      ])
      const { client } = await signInAs('comptable.demo@medfinder.test')
      const { error } = await client.rpc('post_journal_entry', { p_entry_id: entryId })
      expect(error).toBeTruthy()

      const admin = adminClient()
      const { data: after } = await admin.from('journal_entries').select('status').eq('id', entryId).single()
      expect(after?.status).toBe('draft')
    })

    it('le posting d\'une ecriture equilibree est accepte', async () => {
      const ctx = await setupAccountsAndPeriod(orgA, `ok${Date.now()}`)
      const entryId = await insertDraftEntry(orgA, ctx.journalId, ctx.periodId, [
        { accountId: ctx.debitAccountId, debit: 100, credit: 0 },
        { accountId: ctx.creditAccountId, debit: 0, credit: 100 },
      ])
      const { client } = await signInAs('comptable.demo@medfinder.test')
      const { data, error } = await client.rpc('post_journal_entry', { p_entry_id: entryId })
      expect(error).toBeNull()
      expect((data as { success: boolean })?.success).toBe(true)

      const admin = adminClient()
      const { data: after } = await admin.from('journal_entries').select('status, posted_by, posted_at').eq('id', entryId).single()
      expect(after?.status).toBe('posted')
      expect(after?.posted_by).toBeTruthy()
      expect(after?.posted_at).toBeTruthy()
    })

    it('une ecriture avec moins de 2 lignes est refusee au posting', async () => {
      const ctx = await setupAccountsAndPeriod(orgA, `1line${Date.now()}`)
      const entryId = await insertDraftEntry(orgA, ctx.journalId, ctx.periodId, [
        { accountId: ctx.debitAccountId, debit: 100, credit: 0 },
      ])
      const { client } = await signInAs('comptable.demo@medfinder.test')
      const { error } = await client.rpc('post_journal_entry', { p_entry_id: entryId })
      expect(error).toBeTruthy()
    })

    it('DG (sans accounting.post) ne peut pas comptabiliser', async () => {
      const ctx = await setupAccountsAndPeriod(orgA, `dg${Date.now()}`)
      const entryId = await insertDraftEntry(orgA, ctx.journalId, ctx.periodId, [
        { accountId: ctx.debitAccountId, debit: 100, credit: 0 },
        { accountId: ctx.creditAccountId, debit: 0, credit: 100 },
      ])
      const { client } = await signInAs('dg.demo@medfinder.test')
      const { data, error } = await client.rpc('post_journal_entry', { p_entry_id: entryId })
      expect(error).toBeNull()
      expect((data as { success: boolean; error: string })?.success).toBe(false)
      expect((data as { success: boolean; error: string })?.error).toBe('not_authorized')
    })
  })

  describe('Immutabilite post-POSTED', () => {
    async function postedEntry() {
      const ctx = await setupAccountsAndPeriod(orgA, `imm${Date.now()}`)
      const entryId = await insertDraftEntry(orgA, ctx.journalId, ctx.periodId, [
        { accountId: ctx.debitAccountId, debit: 250, credit: 0 },
        { accountId: ctx.creditAccountId, debit: 0, credit: 250 },
      ])
      const { client } = await signInAs('comptable.demo@medfinder.test')
      const { error } = await client.rpc('post_journal_entry', { p_entry_id: entryId })
      expect(error).toBeNull()
      return entryId
    }

    it('modifier une ligne d\'une ecriture postee est refuse (meme via service_role)', async () => {
      const entryId = await postedEntry()
      const admin = adminClient()
      const { data: lines } = await admin.from('journal_entry_lines').select('id').eq('entry_id', entryId)
      const { error } = await admin
        .from('journal_entry_lines')
        .update({ debit: 999 })
        .eq('id', (lines![0] as { id: string }).id)
      expect(error).toBeTruthy()
    })

    it('supprimer une ligne d\'une ecriture postee est refuse (meme via service_role)', async () => {
      const entryId = await postedEntry()
      const admin = adminClient()
      const { data: lines } = await admin.from('journal_entry_lines').select('id').eq('entry_id', entryId)
      const { error } = await admin
        .from('journal_entry_lines')
        .delete()
        .eq('id', (lines![0] as { id: string }).id)
      expect(error).toBeTruthy()
    })

    it('modifier une ecriture postee est refuse (meme via service_role)', async () => {
      const entryId = await postedEntry()
      const admin = adminClient()
      const { error } = await admin.from('journal_entries').update({ description: 'hack' }).eq('id', entryId)
      expect(error).toBeTruthy()
    })

    it('supprimer une ecriture postee est refuse (meme via service_role)', async () => {
      const entryId = await postedEntry()
      const admin = adminClient()
      const { error } = await admin.from('journal_entries').delete().eq('id', entryId)
      expect(error).toBeTruthy()
    })
  })

  describe('Periodes fermees', () => {
    it('le posting sur une periode fermee est refuse, et la fermeture n\'est jamais silencieusement reouverte', async () => {
      const ctx = await setupAccountsAndPeriod(orgA, `closed${Date.now()}`)
      const entryId = await insertDraftEntry(orgA, ctx.journalId, ctx.periodId, [
        { accountId: ctx.debitAccountId, debit: 60, credit: 0 },
        { accountId: ctx.creditAccountId, debit: 0, credit: 60 },
      ])

      const { client: comptable } = await signInAs('comptable.demo@medfinder.test')
      const { error: closeError } = await comptable
        .from('accounting_periods')
        .update({ status: 'closed' })
        .eq('id', ctx.periodId)
      expect(closeError).toBeNull()

      const { error: postError } = await comptable.rpc('post_journal_entry', { p_entry_id: entryId })
      expect(postError).toBeTruthy()

      // Aucune reouverture, meme via service_role (trigger d'immutabilite).
      const admin = adminClient()
      const { error: reopenError } = await admin
        .from('accounting_periods')
        .update({ status: 'open' })
        .eq('id', ctx.periodId)
      expect(reopenError).toBeTruthy()
    })
  })

  describe('Contre-passation', () => {
    it('reverse_journal_entry cree une nouvelle ecriture, l\'originale reste strictement intacte', async () => {
      const ctx = await setupAccountsAndPeriod(orgA, `rev${Date.now()}`)
      const entryId = await insertDraftEntry(orgA, ctx.journalId, ctx.periodId, [
        { accountId: ctx.debitAccountId, debit: 500, credit: 0 },
        { accountId: ctx.creditAccountId, debit: 0, credit: 500 },
      ])
      const { client } = await signInAs('comptable.demo@medfinder.test')
      await client.rpc('post_journal_entry', { p_entry_id: entryId })

      const admin = adminClient()
      const { data: originalBefore } = await admin.from('journal_entries').select('*').eq('id', entryId).single()

      const { data: reverseResult, error: reverseError } = await client.rpc('reverse_journal_entry', {
        p_entry_id: entryId,
        p_reason: 'Test contre-passation',
      })
      expect(reverseError).toBeNull()
      expect((reverseResult as { success: boolean })?.success).toBe(true)
      const reversalId = (reverseResult as { reversal_entry_id: string }).reversal_entry_id
      expect(reversalId).toBeTruthy()

      const { data: originalAfter } = await admin.from('journal_entries').select('*').eq('id', entryId).single()
      expect(originalAfter).toEqual(originalBefore)

      const { data: reversalEntry } = await admin.from('journal_entries').select('*').eq('id', reversalId).single()
      expect(reversalEntry?.status).toBe('posted')
      expect(reversalEntry?.reversed_entry_id).toBe(entryId)

      const { data: reversalLines } = await admin
        .from('journal_entry_lines')
        .select('account_id, debit, credit')
        .eq('entry_id', reversalId)
      const debitLine = reversalLines!.find((l) => (l as { account_id: string }).account_id === ctx.creditAccountId)
      const creditLine = reversalLines!.find((l) => (l as { account_id: string }).account_id === ctx.debitAccountId)
      expect(Number(debitLine?.debit)).toBe(500)
      expect(Number(creditLine?.credit)).toBe(500)
    })

    it('DG (sans accounting.reverse) ne peut pas contre-passer', async () => {
      const ctx = await setupAccountsAndPeriod(orgA, `revdg${Date.now()}`)
      const entryId = await insertDraftEntry(orgA, ctx.journalId, ctx.periodId, [
        { accountId: ctx.debitAccountId, debit: 80, credit: 0 },
        { accountId: ctx.creditAccountId, debit: 0, credit: 80 },
      ])
      const { client: comptable } = await signInAs('comptable.demo@medfinder.test')
      await comptable.rpc('post_journal_entry', { p_entry_id: entryId })

      const { client: dg } = await signInAs('dg.demo@medfinder.test')
      const { data, error } = await dg.rpc('reverse_journal_entry', { p_entry_id: entryId, p_reason: 'test' })
      expect(error).toBeNull()
      expect((data as { success: boolean; error: string })?.success).toBe(false)
      expect((data as { success: boolean; error: string })?.error).toBe('not_authorized')
    })
  })

  describe('Isolation multi-organisation', () => {
    it('un comptable d\'Org B ne voit aucune donnee comptable d\'Org A', async () => {
      const ctx = await setupAccountsAndPeriod(orgA, `iso${Date.now()}`)
      void ctx
      const { client } = await signInAs('orgb.demo@medfinder.test')
      const { data: fyData } = await client.from('fiscal_years').select('id').eq('organization_id', orgA)
      const { data: coaData } = await client.from('chart_of_accounts').select('id').eq('organization_id', orgA)
      const { data: periodData } = await client.from('accounting_periods').select('id').eq('organization_id', orgA)
      const { data: entriesData } = await client.from('journal_entries').select('id').eq('organization_id', orgA)
      expect(fyData ?? []).toEqual([])
      expect(coaData ?? []).toEqual([])
      expect(periodData ?? []).toEqual([])
      expect(entriesData ?? []).toEqual([])
      void orgB
    })

    it('un comptable d\'Org B ne peut pas comptabiliser une ecriture d\'Org A', async () => {
      const ctx = await setupAccountsAndPeriod(orgA, `isopost${Date.now()}`)
      const entryId = await insertDraftEntry(orgA, ctx.journalId, ctx.periodId, [
        { accountId: ctx.debitAccountId, debit: 30, credit: 0 },
        { accountId: ctx.creditAccountId, debit: 0, credit: 30 },
      ])
      const { client } = await signInAs('orgb.demo@medfinder.test')
      const { data, error } = await client.rpc('post_journal_entry', { p_entry_id: entryId })
      expect(error).toBeNull()
      expect((data as { success: boolean; error: string })?.success).toBe(false)
      expect((data as { success: boolean; error: string })?.error).toBe('not_authorized')
    })
  })
})
