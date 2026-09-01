import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { signInAs, adminClient, getOrgIdByName } from './helpers'
import { FixtureRegistry, tag } from '../support/fixture-registry'

/**
 * Phase 2D — rapprochement bancaire et de tresorerie.
 *
 * Principe verifie en permanence : le rapprochement ne cree JAMAIS
 * d'ecriture comptable. Un test dedie le prouve par comptage
 * avant/apres sur journal_entries.
 *
 * Hermeticite : chaque test travaille sur SON propre compte de
 * tresorerie et SON propre import, jamais sur un agregat de
 * l'organisation — un mouvement rapproche ne peut plus etre nettoye.
 */
describe('Phase 2D — Rapprochement bancaire', () => {
  let orgA: string
  let orgB: string
  let comptable: Awaited<ReturnType<typeof signInAs>>['client']
  let comptableId: string
  let otherUserId: string
  const registry = new FixtureRegistry()

  beforeAll(async () => {
    orgA = await getOrgIdByName('MedFinder Demo — Organisation A')
    orgB = await getOrgIdByName('MedFinder Demo — Organisation B')
    const s = await signInAs('comptable.demo@medfinder.test')
    comptable = s.client
    comptableId = s.userId
    const admin = adminClient()
    otherUserId = (await admin.from('users').select('id').eq('full_name', 'Demo Manager').single()).data!.id as string
  })

  afterAll(async () => {
    await registry.cleanup(adminClient())
  })

  /** Compte de caisse dedie, avec son compte comptable. */
  async function createCashAccount(orgId: string, label: string, currency = 'HTG') {
    const admin = adminClient()
    const { data: gl } = await admin
      .from('chart_of_accounts')
      .insert({ organization_id: orgId, code: `TRZ2D-${label}`, label: tag(`Caisse ${label}`), type: 'asset' })
      .select('id').single()
    registry.track('chart_of_accounts', gl!.id as string)

    const { data, error } = await admin
      .from('cash_accounts')
      .insert({ organization_id: orgId, name: tag(`Caisse ${label}`), currency, gl_account_id: gl!.id })
      .select('id').single()
    if (error) throw error
    registry.track('cash_accounts', data!.id as string)
    return data!.id as string
  }

  /** Mouvement de tresorerie brut (sans passer par un workflow metier). */
  async function createMovement(
    orgId: string, accountId: string,
    opts: { direction?: 'in' | 'out'; amount: number; date: string; currency?: string }
  ) {
    const admin = adminClient()
    const { data, error } = await admin
      .from('cash_movements')
      .insert({
        organization_id: orgId,
        treasury_account_type: 'cash',
        treasury_account_id: accountId,
        direction: opts.direction ?? 'in',
        amount: opts.amount,
        currency: opts.currency ?? 'HTG',
        movement_date: opts.date,
        reference_type: 'manual',
        description: tag('Mouvement 2D'),
      })
      .select('id').single()
    if (error) throw error
    registry.track('cash_movements', data!.id as string)
    return data!.id as string
  }

  type LineSpec = { value_date: string; amount: number; direction?: 'in' | 'out'; label?: string; reference?: string }

  async function importStatement(
    accountId: string,
    lines: LineSpec[],
    opts: { orgId?: string; reference?: string; start?: string; end?: string; closing?: number; client?: typeof comptable } = {}
  ) {
    const c = opts.client ?? comptable
    const { data, error } = await c.rpc('import_bank_statement', {
      p_org_id: opts.orgId ?? orgA,
      p_treasury_account_type: 'cash',
      p_treasury_account_id: accountId,
      p_statement_reference: opts.reference ?? tag(`Releve ${Date.now()}`),
      p_period_start: opts.start ?? '2026-04-01',
      p_period_end: opts.end ?? '2026-04-30',
      p_opening_balance: 0,
      p_closing_balance: opts.closing ?? 0,
      p_lines: lines.map((l) => ({
        value_date: l.value_date,
        label: l.label ?? 'Operation',
        external_reference: l.reference ?? null,
        direction: l.direction ?? 'in',
        amount: l.amount,
      })),
    })
    if (error) throw error
    const res = data as Record<string, unknown>
    if (res.success) registry.track('bank_statement_imports', res.import_id as string)
    return res
  }

  async function linesOf(importId: string) {
    const { data } = await adminClient()
      .from('bank_statement_lines')
      .select('id, line_number, status, amount, direction, value_date')
      .eq('import_id', importId)
      .order('line_number')
    return (data ?? []) as Record<string, unknown>[]
  }

  async function matchesOf(importId: string) {
    const admin = adminClient()
    const { data: lines } = await admin.from('bank_statement_lines').select('id').eq('import_id', importId)
    const ids = (lines ?? []).map((l) => l.id as string)
    if (ids.length === 0) return []
    const { data } = await admin
      .from('bank_reconciliation_matches')
      .select('id, statement_line_id, cash_movement_id, status, match_type, amount_difference, date_difference_days')
      .in('statement_line_id', ids)
    return (data ?? []) as Record<string, unknown>[]
  }

  /** Valide un rapprochement en respectant la SoD (proposant != validateur). */
  async function validateAs(matchId: string, client = comptable) {
    const { data } = await client.rpc('validate_bank_match', { p_match_id: matchId })
    return data as Record<string, unknown>
  }

  // ==================================================================
  describe('Import de releve', () => {
    it('import valide : lignes normalisees, devise deduite du compte', async () => {
      const acc = await createCashAccount(orgA, `imp${Date.now()}`)
      const res = await importStatement(acc, [
        { value_date: '2026-04-05', amount: 500, direction: 'in', label: 'Depot' },
        { value_date: '2026-04-07', amount: 200, direction: 'out', label: 'Retrait' },
      ])
      expect(res.success, JSON.stringify(res)).toBe(true)
      expect(res.line_count).toBe(2)
      expect(res.currency, 'devise deduite du compte, jamais fournie').toBe('HTG')

      const lines = await linesOf(res.import_id as string)
      expect(lines).toHaveLength(2)
      expect(lines.every((l) => l.status === 'unreconciled')).toBe(true)
    })

    it('DOUBLON d\'import : meme contenu sur le meme compte refuse', async () => {
      const acc = await createCashAccount(orgA, `dup${Date.now()}`)
      const lines: LineSpec[] = [{ value_date: '2026-04-05', amount: 750 }]

      const first = await importStatement(acc, lines, { reference: 'Releve A' })
      expect(first.success).toBe(true)

      // Reference et nom differents, MEME contenu -> refus.
      const second = await importStatement(acc, lines, { reference: 'Releve B (autre nom)' })
      expect(second.success).toBe(false)
      expect(second.error).toBe('duplicate_import')
      expect(second.existing_import_id).toBe(first.import_id)
    })

    it('le meme contenu reste importable sur un AUTRE compte', async () => {
      const a1 = await createCashAccount(orgA, `c1-${Date.now()}`)
      const a2 = await createCashAccount(orgA, `c2-${Date.now()}`)
      const lines: LineSpec[] = [{ value_date: '2026-04-09', amount: 333 }]

      expect((await importStatement(a1, lines)).success).toBe(true)
      expect((await importStatement(a2, lines)).success).toBe(true)
    })

    it('compte de tresorerie inexistant refuse', async () => {
      const res = await importStatement('00000000-0000-0000-0000-000000000000', [
        { value_date: '2026-04-05', amount: 100 },
      ])
      expect(res.success).toBe(false)
      expect(res.error).toBe('treasury_account_not_found')
    })

    it('releve sans ligne refuse', async () => {
      const acc = await createCashAccount(orgA, `empty${Date.now()}`)
      const res = await importStatement(acc, [])
      expect(res.success).toBe(false)
      expect(res.error).toBe('no_lines')
    })

    it('periode invalide refusee', async () => {
      const acc = await createCashAccount(orgA, `per${Date.now()}`)
      const res = await importStatement(acc, [{ value_date: '2026-04-05', amount: 100 }], {
        start: '2026-04-30', end: '2026-04-01',
      })
      expect(res.success).toBe(false)
      expect(res.error).toBe('invalid_period')
    })

    it('MAUVAISE ORGANISATION : un compte d\'Org B ne peut pas etre importe sous Org A', async () => {
      const accB = await createCashAccount(orgB, `xorg${Date.now()}`)
      const res = await importStatement(accB, [{ value_date: '2026-04-05', amount: 100 }], { orgId: orgA })
      expect(res.success).toBe(false)
      expect(res.error, 'traite comme inexistant, sans reveler son existence').toBe('treasury_account_not_found')
    })
  })

  // ==================================================================
  describe('Rapprochement automatique deterministe', () => {
    it('correspondance EXACTE : proposition emise, ecarts nuls', async () => {
      const acc = await createCashAccount(orgA, `auto${Date.now()}`)
      await createMovement(orgA, acc, { amount: 1000, date: '2026-04-10' })
      const imp = await importStatement(acc, [{ value_date: '2026-04-10', amount: 1000 }])

      const { data } = await comptable.rpc('propose_bank_reconciliation', { p_import_id: imp.import_id })
      const res = data as Record<string, unknown>
      expect(res.success, JSON.stringify(res)).toBe(true)
      expect(res.proposed).toBe(1)

      const matches = await matchesOf(imp.import_id as string)
      expect(matches).toHaveLength(1)
      expect(matches[0].match_type).toBe('auto')
      expect(matches[0].status).toBe('proposed')
      expect(Number(matches[0].amount_difference)).toBe(0)
      expect(Number(matches[0].date_difference_days)).toBe(0)
    })

    it('tolerance de date : correspondance a +/- 3 jours, ecart enregistre', async () => {
      const acc = await createCashAccount(orgA, `tol${Date.now()}`)
      await createMovement(orgA, acc, { amount: 640, date: '2026-04-12' })
      const imp = await importStatement(acc, [{ value_date: '2026-04-14', amount: 640 }])

      const { data } = await comptable.rpc('propose_bank_reconciliation', { p_import_id: imp.import_id })
      expect((data as Record<string, unknown>).proposed).toBe(1)

      const matches = await matchesOf(imp.import_id as string)
      expect(Number(matches[0].date_difference_days), 'ecart de date mesure et conserve').toBe(2)
    })

    it('AMBIGUITE : deux candidats identiques => aucune proposition', async () => {
      const acc = await createCashAccount(orgA, `amb${Date.now()}`)
      await createMovement(orgA, acc, { amount: 400, date: '2026-04-15' })
      await createMovement(orgA, acc, { amount: 400, date: '2026-04-15' })
      const imp = await importStatement(acc, [{ value_date: '2026-04-15', amount: 400 }])

      const { data } = await comptable.rpc('propose_bank_reconciliation', { p_import_id: imp.import_id })
      const res = data as Record<string, unknown>
      expect(res.proposed, 'determinisme : aucune proposition en cas d\'ambiguite').toBe(0)
      expect(res.ambiguous).toBe(1)
      expect(await matchesOf(imp.import_id as string)).toHaveLength(0)
    })

    it('MONTANT different : aucune correspondance automatique', async () => {
      const acc = await createCashAccount(orgA, `amt${Date.now()}`)
      await createMovement(orgA, acc, { amount: 999, date: '2026-04-16' })
      const imp = await importStatement(acc, [{ value_date: '2026-04-16', amount: 1000 }])

      const { data } = await comptable.rpc('propose_bank_reconciliation', { p_import_id: imp.import_id })
      expect((data as Record<string, unknown>).proposed).toBe(0)
      expect((data as Record<string, unknown>).unmatched).toBe(1)
    })

    it('SENS different : aucune correspondance automatique', async () => {
      const acc = await createCashAccount(orgA, `dir${Date.now()}`)
      await createMovement(orgA, acc, { amount: 250, date: '2026-04-17', direction: 'out' })
      const imp = await importStatement(acc, [{ value_date: '2026-04-17', amount: 250, direction: 'in' }])

      const { data } = await comptable.rpc('propose_bank_reconciliation', { p_import_id: imp.import_id })
      expect((data as Record<string, unknown>).proposed).toBe(0)
    })

    it('un mouvement deja engage n\'est jamais repropose', async () => {
      const acc = await createCashAccount(orgA, `eng${Date.now()}`)
      await createMovement(orgA, acc, { amount: 555, date: '2026-04-18' })

      const imp1 = await importStatement(acc, [{ value_date: '2026-04-18', amount: 555, label: 'A' }])
      await comptable.rpc('propose_bank_reconciliation', { p_import_id: imp1.import_id })
      expect(await matchesOf(imp1.import_id as string)).toHaveLength(1)

      const imp2 = await importStatement(acc, [{ value_date: '2026-04-18', amount: 555, label: 'B' }])
      const { data } = await comptable.rpc('propose_bank_reconciliation', { p_import_id: imp2.import_id })
      expect((data as Record<string, unknown>).proposed, 'mouvement deja engage').toBe(0)
    })
  })

  // ==================================================================
  describe('Rapprochement manuel et ecarts', () => {
    it('rapprochement manuel avec ECART DE MONTANT : enregistre, jamais absorbe', async () => {
      const acc = await createCashAccount(orgA, `man${Date.now()}`)
      const mv = await createMovement(orgA, acc, { amount: 480, date: '2026-04-20' })
      const imp = await importStatement(acc, [{ value_date: '2026-04-20', amount: 500 }])
      const [line] = await linesOf(imp.import_id as string)

      const { data } = await comptable.rpc('create_manual_bank_match', {
        p_statement_line_id: line.id, p_cash_movement_id: mv,
      })
      const res = data as Record<string, unknown>
      expect(res.success, JSON.stringify(res)).toBe(true)
      expect(Number(res.amount_difference), '500 releve - 480 comptable').toBe(20)

      const after = await linesOf(imp.import_id as string)
      expect(after[0].status, 'la ligne est marquee en ecart').toBe('discrepancy')
    })

    it('rapprochement manuel avec ECART DE DATE : mesure et conserve', async () => {
      const acc = await createCashAccount(orgA, `mdate${Date.now()}`)
      const mv = await createMovement(orgA, acc, { amount: 300, date: '2026-04-21' })
      const imp = await importStatement(acc, [{ value_date: '2026-04-26', amount: 300 }])
      const [line] = await linesOf(imp.import_id as string)

      const { data } = await comptable.rpc('create_manual_bank_match', {
        p_statement_line_id: line.id, p_cash_movement_id: mv,
      })
      const res = data as Record<string, unknown>
      expect(res.success).toBe(true)
      expect(Number(res.date_difference_days)).toBe(5)
      expect(Number(res.amount_difference)).toBe(0)
    })

    it('DEVISE incompatible refusee', async () => {
      const accHtg = await createCashAccount(orgA, `chtg${Date.now()}`, 'HTG')
      const imp = await importStatement(accHtg, [{ value_date: '2026-04-22', amount: 100 }])
      const [line] = await linesOf(imp.import_id as string)

      // Mouvement USD sur le meme compte : incoherent, mais on force en
      // base pour verifier que la RPC refuse.
      const admin = adminClient()
      const { data: mv } = await admin.from('cash_movements').insert({
        organization_id: orgA, treasury_account_type: 'cash', treasury_account_id: accHtg,
        direction: 'in', amount: 100, currency: 'USD', movement_date: '2026-04-22',
        reference_type: 'manual', description: tag('USD sur compte HTG'),
      }).select('id').single()
      registry.track('cash_movements', mv!.id as string)

      const { data } = await comptable.rpc('create_manual_bank_match', {
        p_statement_line_id: line.id, p_cash_movement_id: mv!.id,
      })
      expect((data as Record<string, unknown>).success).toBe(false)
      expect((data as Record<string, unknown>).error).toBe('currency_mismatch')
    })

    it('SENS incompatible refuse', async () => {
      const acc = await createCashAccount(orgA, `msens${Date.now()}`)
      const mv = await createMovement(orgA, acc, { amount: 120, date: '2026-04-23', direction: 'out' })
      const imp = await importStatement(acc, [{ value_date: '2026-04-23', amount: 120, direction: 'in' }])
      const [line] = await linesOf(imp.import_id as string)

      const { data } = await comptable.rpc('create_manual_bank_match', {
        p_statement_line_id: line.id, p_cash_movement_id: mv,
      })
      expect((data as Record<string, unknown>).error).toBe('direction_mismatch')
    })

    it('IDOR : un mouvement d\'Org B est traite comme inexistant', async () => {
      const accA = await createCashAccount(orgA, `idorA${Date.now()}`)
      const accB = await createCashAccount(orgB, `idorB${Date.now()}`)
      const mvB = await createMovement(orgB, accB, { amount: 700, date: '2026-04-24' })
      const imp = await importStatement(accA, [{ value_date: '2026-04-24', amount: 700 }])
      const [line] = await linesOf(imp.import_id as string)

      const { data } = await comptable.rpc('create_manual_bank_match', {
        p_statement_line_id: line.id, p_cash_movement_id: mvB,
      })
      expect((data as Record<string, unknown>).success).toBe(false)
      expect((data as Record<string, unknown>).error).toBe('cash_movement_not_found')
    })
  })

  // ==================================================================
  describe('Validation, SoD et double rapprochement', () => {
    /** Prepare une proposition dont le proposant est un AUTRE acteur. */
    async function proposedByOther() {
      const acc = await createCashAccount(orgA, `sod${Date.now()}${Math.floor(Math.random() * 1000)}`)
      const mv = await createMovement(orgA, acc, { amount: 800, date: '2026-04-25' })
      const imp = await importStatement(acc, [{ value_date: '2026-04-25', amount: 800 }])
      const [line] = await linesOf(imp.import_id as string)

      const admin = adminClient()
      const { data: match } = await admin.from('bank_reconciliation_matches').insert({
        organization_id: orgA,
        statement_line_id: line.id,
        cash_movement_id: mv,
        match_type: 'manual',
        status: 'proposed',
        proposed_by: otherUserId,
      }).select('id').single()
      registry.track('bank_reconciliation_matches', match!.id as string)
      await admin.from('bank_statement_lines').update({ status: 'proposed' }).eq('id', line.id)

      return { importId: imp.import_id as string, lineId: line.id as string, movementId: mv, matchId: match!.id as string }
    }

    it('SoD : le proposant ne peut pas valider son propre rapprochement', async () => {
      const acc = await createCashAccount(orgA, `self${Date.now()}`)
      const mv = await createMovement(orgA, acc, { amount: 900, date: '2026-04-25' })
      const imp = await importStatement(acc, [{ value_date: '2026-04-25', amount: 900 }])
      const [line] = await linesOf(imp.import_id as string)

      // Le comptable propose lui-meme...
      const { data: proposal } = await comptable.rpc('create_manual_bank_match', {
        p_statement_line_id: line.id, p_cash_movement_id: mv,
      })
      const matchId = (proposal as Record<string, unknown>).match_id as string

      // ...puis tente de valider.
      const res = await validateAs(matchId)
      expect(res.success).toBe(false)
      expect(res.error).toBe('self_validation_blocked')

      const admin = adminClient()
      const { data: mvAfter } = await admin.from('cash_movements').select('reconciled').eq('id', mv).single()
      expect(mvAfter!.reconciled, 'aucun verrouillage sans validation').toBe(false)
    })

    it('validation par un acteur DISTINCT : ligne rapprochee et mouvement verrouille', async () => {
      const ctx = await proposedByOther()
      const res = await validateAs(ctx.matchId)
      expect(res.success, JSON.stringify(res)).toBe(true)

      const lines = await linesOf(ctx.importId)
      expect(lines[0].status).toBe('reconciled')

      const admin = adminClient()
      const { data: mv } = await admin.from('cash_movements').select('reconciled').eq('id', ctx.movementId).single()
      expect(mv!.reconciled, 'le drapeau operationnel est pose').toBe(true)
    })

    it('DOUBLE RAPPROCHEMENT : un mouvement deja rapproche ne peut pas l\'etre a nouveau', async () => {
      const ctx = await proposedByOther()
      expect((await validateAs(ctx.matchId)).success).toBe(true)

      // Nouvelle ligne, meme mouvement.
      const acc2 = await createCashAccount(orgA, `dbl${Date.now()}`)
      const imp2 = await importStatement(acc2, [{ value_date: '2026-04-25', amount: 800 }])
      const [line2] = await linesOf(imp2.import_id as string)

      const { data } = await comptable.rpc('create_manual_bank_match', {
        p_statement_line_id: line2.id, p_cash_movement_id: ctx.movementId,
      })
      expect((data as Record<string, unknown>).success).toBe(false)
      // Le compte differe -> le trigger de coherence refuse aussi ; dans
      // les deux cas, le double rapprochement est impossible.
      expect(['movement_already_matched', 'cash_movement_not_found']).toContain(
        (data as Record<string, unknown>).error
      )
    })

    it('GARANTIE BASE : deux rapprochements valides sur la meme ligne sont impossibles', async () => {
      const ctx = await proposedByOther()
      expect((await validateAs(ctx.matchId)).success).toBe(true)

      const admin = adminClient()
      // Second mouvement sur LE MEME compte que l'import, pour que seul
      // l'index unique puisse expliquer le refus (et non le trigger de
      // coherence de compte).
      const { data: impRow } = await admin
        .from('bank_statement_imports')
        .select('treasury_account_id')
        .eq('id', ctx.importId)
        .single()
      const mv2 = await createMovement(orgA, impRow!.treasury_account_id as string, {
        amount: 800, date: '2026-04-25',
      })

      const { error } = await admin.from('bank_reconciliation_matches').insert({
        organization_id: orgA,
        statement_line_id: ctx.lineId,
        cash_movement_id: mv2,
        match_type: 'manual',
        status: 'validated',
        proposed_by: otherUserId,
        validated_by: comptableId,
        validated_at: new Date().toISOString(),
      })
      expect(error, 'index unique partiel : un seul rapprochement valide par ligne').toBeTruthy()
    })

    it('validation deja effectuee : seconde tentative refusee', async () => {
      const ctx = await proposedByOther()
      expect((await validateAs(ctx.matchId)).success).toBe(true)
      const second = await validateAs(ctx.matchId)
      expect(second.success).toBe(false)
      expect(second.error).toBe('invalid_status')
    })

    it('rejet motive : la ligne redevient disponible', async () => {
      const ctx = await proposedByOther()
      const { data } = await comptable.rpc('reject_bank_match', {
        p_match_id: ctx.matchId, p_reason: 'Mouvement sans rapport',
      })
      expect((data as Record<string, unknown>).success).toBe(true)

      const lines = await linesOf(ctx.importId)
      expect(lines[0].status).toBe('unreconciled')
    })

    it('rejet sans motif refuse', async () => {
      const ctx = await proposedByOther()
      const { data } = await comptable.rpc('reject_bank_match', { p_match_id: ctx.matchId, p_reason: '  ' })
      expect((data as Record<string, unknown>).error).toBe('reason_required')
    })
  })

  // ==================================================================
  describe('Periode comptable clturee', () => {
    it('validation refusee si le mouvement releve d\'une periode fermee', async () => {
      const admin = adminClient()
      const year = 2037
      const { data: fy } = await admin.from('fiscal_years').insert({
        organization_id: orgA, label: tag(`FY-2D-${Date.now()}`),
        start_date: `${year}-01-01`, end_date: `${year}-12-31`,
      }).select('id').single()
      registry.track('fiscal_years', fy!.id as string)
      const { data: period } = await admin.from('accounting_periods').insert({
        organization_id: orgA, fiscal_year_id: fy!.id, month: 7, status: 'closed',
      }).select('id').single()
      registry.track('accounting_periods', period!.id as string)

      const acc = await createCashAccount(orgA, `clos${Date.now()}`)
      const mv = await createMovement(orgA, acc, { amount: 450, date: `${year}-07-10` })
      const imp = await importStatement(acc, [{ value_date: `${year}-07-10`, amount: 450 }], {
        start: `${year}-07-01`, end: `${year}-07-31`,
      })
      const [line] = await linesOf(imp.import_id as string)

      const { data: match } = await admin.from('bank_reconciliation_matches').insert({
        organization_id: orgA, statement_line_id: line.id, cash_movement_id: mv,
        match_type: 'manual', status: 'proposed', proposed_by: otherUserId,
      }).select('id').single()
      registry.track('bank_reconciliation_matches', match!.id as string)

      const res = await validateAs(match!.id as string)
      expect(res.success).toBe(false)
      expect(res.error).toBe('period_closed')

      const { data: mvAfter } = await admin.from('cash_movements').select('reconciled').eq('id', mv).single()
      expect(mvAfter!.reconciled).toBe(false)
    })
  })

  // ==================================================================
  describe('Immutabilite et non-destruction', () => {
    async function validatedMatch() {
      const acc = await createCashAccount(orgA, `immu${Date.now()}${Math.floor(Math.random() * 1000)}`)
      const mv = await createMovement(orgA, acc, { amount: 660, date: '2026-04-28' })
      const imp = await importStatement(acc, [{ value_date: '2026-04-28', amount: 660 }])
      const [line] = await linesOf(imp.import_id as string)

      const admin = adminClient()
      const { data: match } = await admin.from('bank_reconciliation_matches').insert({
        organization_id: orgA, statement_line_id: line.id, cash_movement_id: mv,
        match_type: 'auto', status: 'proposed', proposed_by: otherUserId,
      }).select('id').single()
      registry.track('bank_reconciliation_matches', match!.id as string)
      await admin.from('bank_statement_lines').update({ status: 'proposed' }).eq('id', line.id)

      expect((await validateAs(match!.id as string)).success).toBe(true)
      return { matchId: match!.id as string, importId: imp.import_id as string, lineId: line.id as string }
    }

    it('un rapprochement VALIDE n\'est pas supprimable, meme via service_role', async () => {
      const ctx = await validatedMatch()
      const admin = adminClient()
      const { error } = await admin.from('bank_reconciliation_matches').delete().eq('id', ctx.matchId)
      expect(error, 'aucune suppression destructive d\'un rapprochement valide').toBeTruthy()
    })

    it('un rapprochement VALIDE n\'est pas modifiable', async () => {
      const ctx = await validatedMatch()
      const admin = adminClient()
      expect((await admin.from('bank_reconciliation_matches').update({ status: 'proposed' }).eq('id', ctx.matchId)).error).toBeTruthy()
      expect((await admin.from('bank_reconciliation_matches').update({ amount_difference: 99 }).eq('id', ctx.matchId)).error).toBeTruthy()
    })

    it('les donnees importees d\'une ligne sont immuables', async () => {
      const acc = await createCashAccount(orgA, `limmu${Date.now()}`)
      const imp = await importStatement(acc, [{ value_date: '2026-04-29', amount: 111 }])
      const [line] = await linesOf(imp.import_id as string)
      const admin = adminClient()
      expect((await admin.from('bank_statement_lines').update({ amount: 222 }).eq('id', line.id)).error).toBeTruthy()
      expect((await admin.from('bank_statement_lines').update({ direction: 'out' }).eq('id', line.id)).error).toBeTruthy()
    })

    it('annulation d\'import refusee si un rapprochement valide en depend', async () => {
      const ctx = await validatedMatch()
      const { data } = await comptable.rpc('cancel_bank_statement_import', {
        p_import_id: ctx.importId, p_reason: 'Tentative',
      })
      expect((data as Record<string, unknown>).success).toBe(false)
      expect((data as Record<string, unknown>).error).toBe('has_validated_matches')
    })

    it('annulation d\'import possible sans rapprochement valide', async () => {
      const acc = await createCashAccount(orgA, `cancel${Date.now()}`)
      const imp = await importStatement(acc, [{ value_date: '2026-04-30', amount: 77 }])
      const { data } = await comptable.rpc('cancel_bank_statement_import', {
        p_import_id: imp.import_id, p_reason: 'Releve errone',
      })
      expect((data as Record<string, unknown>).success, JSON.stringify(data)).toBe(true)
    })

    it('CYCLE COMPLET : import -> proposition -> annulation -> reimport, le mouvement redevient rapprochable', async () => {
      const acc = await createCashAccount(orgA, `recyc${Date.now()}`)
      const mvId = await createMovement(orgA, acc, { amount: 1234, date: '2026-04-18' })
      const lines: LineSpec[] = [{ value_date: '2026-04-18', amount: 1234 }]

      // 1. Import + proposition automatique : le mouvement est reserve.
      const imp1 = await importStatement(acc, lines, { reference: 'Cycle 1' })
      expect(imp1.success, JSON.stringify(imp1)).toBe(true)
      const prop1 = (await comptable.rpc('propose_bank_reconciliation', { p_import_id: imp1.import_id }))
        .data as Record<string, unknown>
      expect(prop1.proposed).toBe(1)

      // 2. Annulation de l'import : la proposition en attente est neutralisee.
      const cancel = (await comptable.rpc('cancel_bank_statement_import', {
        p_import_id: imp1.import_id, p_reason: 'Releve remplace par le correctif banque',
      })).data as Record<string, unknown>
      expect(cancel.success, JSON.stringify(cancel)).toBe(true)
      expect(cancel.neutralised_matches).toBe(1)

      // Etat TERMINAL coherent : plus aucune proposition en suspens.
      const after = await matchesOf(imp1.import_id as string)
      expect(after).toHaveLength(1)
      expect(after[0].status, 'etat terminal, pas laisse en suspens').toBe('rejected')

      const { data: rejected } = await adminClient()
        .from('bank_reconciliation_matches')
        .select('rejection_reason').eq('id', after[0].id as string).single()
      expect(String(rejected!.rejection_reason), 'raison systeme explicite')
        .toContain("Annulation de l'import de releve")

      // Aucune ligne ne reste bloquee dans un statut intermediaire.
      const cancelledLines = await linesOf(imp1.import_id as string)
      expect(cancelledLines.every((l) => l.status === 'unreconciled')).toBe(true)

      // Le mouvement n'est PAS marque rapproche : jamais reserve par une
      // proposition non validee et desormais annulee.
      const { data: mv } = await adminClient()
        .from('cash_movements').select('reconciled').eq('id', mvId).single()
      expect(mv!.reconciled).toBe(false)

      // 3. Reimport du MEME contenu : plus aucun blocage d'unicite.
      const imp2 = await importStatement(acc, lines, { reference: 'Cycle 2' })
      expect(imp2.success, JSON.stringify(imp2)).toBe(true)

      // 4. Le mouvement redevient reellement rapprochable.
      const prop2 = (await comptable.rpc('propose_bank_reconciliation', { p_import_id: imp2.import_id }))
        .data as Record<string, unknown>
      expect(prop2.success, JSON.stringify(prop2)).toBe(true)
      expect(prop2.proposed, 'le mouvement redevient candidat').toBe(1)

      const matches2 = await matchesOf(imp2.import_id as string)
      expect(matches2).toHaveLength(1)
      expect(matches2[0].cash_movement_id).toBe(mvId)
      expect(matches2[0].status).toBe('proposed')
    })
  })

  // ==================================================================
  describe('Integrite du compte de tresorerie en base', () => {
    it('GARDE DB : un import rattache au compte d\'une AUTRE organisation est refuse, meme via service_role', async () => {
      const accB = await createCashAccount(orgB, `dbguard${Date.now()}`)
      const { error } = await adminClient().from('bank_statement_imports').insert({
        organization_id: orgA,
        treasury_account_type: 'cash',
        treasury_account_id: accB,
        statement_reference: tag('Releve force'),
        period_start: '2026-04-01',
        period_end: '2026-04-30',
        currency: 'HTG',
        content_hash: `forced-${Date.now()}`,
      })
      expect(error, 'la garde est en BASE, pas seulement dans import_bank_statement()').not.toBeNull()
      expect(error!.message).toContain("n'appartient pas a l'organisation")
    })

    it('GARDE DB : la devise du releve doit etre celle du compte, meme via service_role', async () => {
      const acc = await createCashAccount(orgA, `dbcur${Date.now()}`, 'HTG')
      const { error } = await adminClient().from('bank_statement_imports').insert({
        organization_id: orgA,
        treasury_account_type: 'cash',
        treasury_account_id: acc,
        statement_reference: tag('Releve devise'),
        period_start: '2026-04-01',
        period_end: '2026-04-30',
        currency: 'USD',
        content_hash: `forcedcur-${Date.now()}`,
      })
      expect(error).not.toBeNull()
      expect(error!.message).toContain('doit etre celle du compte de tresorerie')
    })
  })

  // ==================================================================
  describe('AUCUNE seconde source comptable', () => {
    it('tout le cycle de rapprochement ne cree AUCUNE ecriture comptable', async () => {
      const admin = adminClient()
      const countEntries = async () => {
        const { count } = await admin
          .from('journal_entries')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgA)
        return count ?? 0
      }
      const before = await countEntries()

      const acc = await createCashAccount(orgA, `noje${Date.now()}`)
      const mv = await createMovement(orgA, acc, { amount: 1500, date: '2026-04-27' })
      const imp = await importStatement(acc, [{ value_date: '2026-04-27', amount: 1500 }])
      await comptable.rpc('propose_bank_reconciliation', { p_import_id: imp.import_id })

      const matches = await matchesOf(imp.import_id as string)
      await admin.from('bank_reconciliation_matches')
        .update({ proposed_by: otherUserId }).eq('id', matches[0].id as string)
      expect((await validateAs(matches[0].id as string)).success).toBe(true)

      const after = await countEntries()
      expect(after, 'le rapprochement ne comptabilise jamais').toBe(before)
      void mv
    })
  })

  // ==================================================================
  describe('Etat de rapprochement : solde comptable vs solde releve', () => {
    it('soldes, ecart et lignes non rapprochees restitues', async () => {
      const acc = await createCashAccount(orgA, `rep${Date.now()}`)
      await createMovement(orgA, acc, { amount: 1000, date: '2026-04-03' })
      await createMovement(orgA, acc, { amount: 250, date: '2026-04-04', direction: 'out' })

      const imp = await importStatement(acc, [
        { value_date: '2026-04-03', amount: 1000 },
        { value_date: '2026-04-04', amount: 250, direction: 'out' },
        { value_date: '2026-04-06', amount: 80, label: 'Frais bancaires', direction: 'out' },
      ], { closing: 670 })

      const { data } = await comptable.rpc('generate_bank_reconciliation_report', {
        p_import_id: imp.import_id,
      })
      const rep = data as Record<string, unknown>
      expect(rep.success, JSON.stringify(rep)).toBe(true)
      expect(Number(rep.book_total_in)).toBe(1000)
      expect(Number(rep.book_total_out)).toBe(250)
      expect(Number(rep.book_closing_balance), 'solde comptable derive des mouvements').toBe(750)
      expect(Number(rep.statement_closing_balance)).toBe(670)
      expect(Number(rep.difference), '750 comptable - 670 releve = 80 (frais non enregistres)').toBe(80)
      expect((rep.unreconciled_statement_lines as unknown[]).length).toBe(3)
    })
  })

  // ==================================================================
  describe('Securite : RLS, permissions, helper confine', () => {
    it('anon ne peut executer aucune RPC de rapprochement', async () => {
      const { createClient } = await import('@supabase/supabase-js')
      const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
      for (const fn of ['propose_bank_reconciliation', 'validate_bank_match', 'reject_bank_match']) {
        const { error } = await anon.rpc(fn, { p_import_id: orgA, p_match_id: orgA, p_reason: 'x' })
        expect(error, `${fn} doit etre inaccessible a anon`).toBeTruthy()
      }
    })

    it('EMPLOYE (sans permission tresorerie) est refuse a l\'import', async () => {
      const acc = await createCashAccount(orgA, `emp${Date.now()}`)
      const { client } = await signInAs('employe.demo@medfinder.test')
      const res = await importStatement(acc, [{ value_date: '2026-04-05', amount: 100 }], { client })
      expect(res.success).toBe(false)
      expect(res.error).toBe('not_authorized')
    })

    it('EMPLOYE ne voit aucun releve', async () => {
      const acc = await createCashAccount(orgA, `empv${Date.now()}`)
      const imp = await importStatement(acc, [{ value_date: '2026-04-05', amount: 100 }])
      const { client } = await signInAs('employe.demo@medfinder.test')
      const { data } = await client.from('bank_statement_imports').select('id').eq('id', imp.import_id as string)
      expect(data ?? []).toEqual([])
    })

    it('IDOR : un acteur d\'Org B ne voit pas les releves d\'Org A', async () => {
      const acc = await createCashAccount(orgA, `idorv${Date.now()}`)
      const imp = await importStatement(acc, [{ value_date: '2026-04-05', amount: 100 }])
      const { client } = await signInAs('orgb.demo@medfinder.test')
      const { data } = await client.from('bank_statement_imports').select('id').eq('id', imp.import_id as string)
      expect(data ?? []).toEqual([])
    })

    it('aucune ecriture directe possible dans les tables de rapprochement', async () => {
      const acc = await createCashAccount(orgA, `direct${Date.now()}`)
      const imp = await importStatement(acc, [{ value_date: '2026-04-05', amount: 100 }])
      const [line] = await linesOf(imp.import_id as string)
      const mv = await createMovement(orgA, acc, { amount: 100, date: '2026-04-05' })

      const { error } = await comptable.from('bank_reconciliation_matches').insert({
        organization_id: orgA, statement_line_id: line.id, cash_movement_id: mv,
        match_type: 'manual', status: 'validated',
      })
      expect(error, 'les rapprochements passent exclusivement par les RPC').toBeTruthy()
    })

    it('le helper app_private n\'est pas expose via PostgREST', async () => {
      const { error } = await comptable.rpc('treasury_account_exists', {})
      expect(error).toBeTruthy()
    })

    it('aucune fonction avec search_path mutable', async () => {
      const admin = adminClient()
      for (const schema of ['public', 'app_private']) {
        const { data, error } = await admin.rpc('debug_functions_with_mutable_search_path', { p_schema: schema })
        expect(error).toBeNull()
        expect(data ?? [], `search_path mutable dans ${schema}`).toEqual([])
      }
    })
  })
})
