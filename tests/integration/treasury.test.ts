import { describe, it, expect, beforeAll } from 'vitest'
import { signInAs, signInAsElevated, adminClient, getOrgIdByName } from './helpers'

/**
 * Phase 1C, sous-jalon 1C.2 — Tresorerie. Aucun mouvement (cash_movements)
 * n'est encore produit a ce stade (aucun workflow de paiement livre) —
 * couvre uniquement la configuration des comptes et l'isolation.
 */
describe('Phase 1C.2 — Tresorerie', () => {
  let orgA: string

  beforeAll(async () => {
    orgA = await getOrgIdByName('MedFinder Demo — Organisation A')
  })

  async function glAccount(orgId: string, code: string) {
    const admin = adminClient()
    const { data, error } = await admin
      .from('chart_of_accounts')
      .insert({ organization_id: orgId, code, label: 'Compte tresorerie test', type: 'asset' })
      .select('id')
      .single()
    if (error) throw error
    return data!.id as string
  }

  describe('Comptes de tresorerie (RLS)', () => {
    it('COMPTABLE (treasury.manage) peut creer une caisse', async () => {
      const glId = await glAccount(orgA, `CASH-GL-${Date.now()}`)
      const { client } = await signInAs('comptable.demo@medfinder.test')
      const { data, error } = await client
        .from('cash_accounts')
        .insert({ organization_id: orgA, name: `Caisse test ${Date.now()}`, gl_account_id: glId })
        .select('id')
        .single()
      expect(error).toBeNull()
      expect(data?.id).toBeTruthy()
    })

    it('MANAGER (sans treasury.manage) ne peut pas creer de compte bancaire', async () => {
      const glId = await glAccount(orgA, `BANK-GL-${Date.now()}`)
      const { client } = await signInAs('manager.demo@medfinder.test')
      const { error } = await client
        .from('bank_accounts')
        .insert({ organization_id: orgA, bank_name: 'Refuse', gl_account_id: glId })
      expect(error).toBeTruthy()
    })

    it('DG (accounting.view, sans treasury.manage) peut consulter mais pas creer', async () => {
      const glId = await glAccount(orgA, `MM-GL-${Date.now()}`)
      const admin = adminClient()
      const { data: seeded } = await admin
        .from('mobile_money_accounts')
        .insert({ organization_id: orgA, provider: 'MonCash', gl_account_id: glId })
        .select('id')
        .single()

      // DIRECTEUR_GENERAL exige AAL2 pour toute permission (Phase 1A) — un
      // simple signInAs() laisserait has_permission(..., 'accounting.view')
      // renvoyer false et ferait echouer cette assertion positive.
      const { client, deElevate } = await signInAsElevated('dg.demo@medfinder.test')
      try {
        const { data: seen, error: selectError } = await client
          .from('mobile_money_accounts')
          .select('id')
          .eq('id', seeded!.id)
        expect(selectError).toBeNull()
        expect(seen?.length).toBe(1)

        const { error: insertError } = await client
          .from('mobile_money_accounts')
          .insert({ organization_id: orgA, provider: 'NatCash', gl_account_id: glId })
        expect(insertError).toBeTruthy()
      } finally {
        await deElevate()
      }
    })

    it('MANAGER (ni treasury.manage ni accounting.view) ne voit aucun compte', async () => {
      const { client } = await signInAs('manager.demo@medfinder.test')
      const { data, error } = await client.from('cash_accounts').select('id').eq('organization_id', orgA)
      expect(error).toBeNull()
      expect((data ?? []).length).toBe(0)
    })

    it("cash_movements n'accepte aucun INSERT direct d'un client authentifie", async () => {
      const { client } = await signInAs('comptable.demo@medfinder.test')
      const { error } = await client.from('cash_movements').insert({
        organization_id: orgA,
        treasury_account_type: 'cash',
        treasury_account_id: '00000000-0000-0000-0000-000000000000',
        direction: 'in',
        amount: 10,
        reference_type: 'manual',
      })
      expect(error).toBeTruthy()
    })
  })

  describe('Isolation multi-organisation', () => {
    it("un acteur d'Org B ne voit aucun compte de tresorerie d'Org A", async () => {
      const glId = await glAccount(orgA, `ISO-GL-${Date.now()}`)
      const admin = adminClient()
      await admin.from('cash_accounts').insert({ organization_id: orgA, name: `Iso ${Date.now()}`, gl_account_id: glId })

      const { client } = await signInAs('orgb.demo@medfinder.test')
      const { data, error } = await client.from('cash_accounts').select('id').eq('organization_id', orgA)
      expect(error).toBeNull()
      expect(data ?? []).toEqual([])
    })
  })
})
