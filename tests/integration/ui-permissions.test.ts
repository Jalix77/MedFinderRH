import { describe, it, expect, beforeAll } from 'vitest'
import { signInAs, signInAsElevated, getOrgIdByName } from './helpers'

/**
 * Phase 1C-UI — matrice de visibilite des ecrans financiers par role
 * (§ regles de securite UI de Phase 1C-UI). Ces 4 permissions sont
 * exactement celles qui gouvernent a la fois la navigation
 * (lib/navigation.ts) et le garde d'acces de chaque page
 * (app/(app)/tresorerie|budget|depenses|papej/page.tsx) — un test direct
 * sur current_user_has_permission verifie donc precisement ce que l'UI
 * afficherait, sans avoir besoin de rendre React.
 *
 * Rappel : ceci teste la couche de confort d'affichage. La protection
 * reelle reste RLS, deja couverte de maniere exhaustive par
 * accounting-core/treasury/budget/expenses/papej.test.ts.
 */
describe('Phase 1C-UI — visibilite des ecrans financiers par role', () => {
  let orgA: string

  beforeAll(async () => {
    orgA = await getOrgIdByName('MedFinder Demo — Organisation A')
  })

  async function screens(client: Awaited<ReturnType<typeof signInAs>>['client']) {
    const check = async (code: string) => {
      const { data } = await client.rpc('current_user_has_permission', { p_org_id: orgA, p_permission_code: code })
      return Boolean(data)
    }
    const [treasuryManage, accountingView, budgetView, expenseView, expenseCreate, papejView] = await Promise.all([
      check('treasury.manage'),
      check('accounting.view'),
      check('budget.view'),
      check('expense.view'),
      check('expense.create'),
      check('papej.view'),
    ])
    return {
      tresorerie: treasuryManage || accountingView,
      budget: budgetView,
      depenses: expenseView || expenseCreate,
      papej: papejView,
    }
  }

  it("EMPLOYE ne voit aucun ecran financier (aucune permission financiere par defaut)", async () => {
    const { client } = await signInAs('employe.demo@medfinder.test')
    const visible = await screens(client)
    expect(visible).toEqual({ tresorerie: false, budget: false, depenses: false, papej: false })
  })

  it("AGENT_TERRAIN ne voit que Depenses (expense.create \"propres\", jamais expense.view/budget/tresorerie/PAPEJ)", async () => {
    const { client } = await signInAs('agent.demo@medfinder.test')
    const visible = await screens(client)
    expect(visible).toEqual({ tresorerie: false, budget: false, depenses: true, papej: false })
  })

  it('MANAGER voit Depenses (ses approbations) et Budget, jamais Tresorerie ni PAPEJ', async () => {
    const { client } = await signInAs('manager.demo@medfinder.test')
    const visible = await screens(client)
    expect(visible).toEqual({ tresorerie: false, budget: true, depenses: true, papej: false })
  })

  it("RH n'obtient aucun acces financier indu (seul Depenses, via expense.view generique, reste visible)", async () => {
    const { client } = await signInAs('rh.demo@medfinder.test')
    const visible = await screens(client)
    expect(visible).toEqual({ tresorerie: false, budget: false, depenses: true, papej: false })
  })

  it('SUPPORT ne voit ni budget ni comptabilite/tresorerie/PAPEJ/depenses', async () => {
    const { client } = await signInAs('support.demo@medfinder.test')
    const visible = await screens(client)
    expect(visible).toEqual({ tresorerie: false, budget: false, depenses: false, papej: false })
  })

  it('COMPTABLE voit toutes les fonctions financieres permises (tresorerie, budget, depenses, PAPEJ)', async () => {
    const { client } = await signInAs('comptable.demo@medfinder.test')
    const visible = await screens(client)
    expect(visible).toEqual({ tresorerie: true, budget: true, depenses: true, papej: true })
  })

  it('DIRECTEUR_TECHNIQUE n\'obtient pas automatiquement les donnees financieres sensibles (seul Depenses reste visible, une fois AAL2 verifie)', async () => {
    // DT detient user.manage (comptes techniques) -> user_requires_mfa(DT)
    // renvoie vrai (Phase 1A) : DT exige aussi AAL2 pour TOUTE permission,
    // au meme titre que DG/SUPER_ADMIN — voir le test complementaire
    // ci-dessous pour la session non elevee.
    const { client, deElevate } = await signInAsElevated('dt.demo@medfinder.test')
    try {
      const visible = await screens(client)
      expect(visible).toEqual({ tresorerie: false, budget: false, depenses: true, papej: false })
    } finally {
      await deElevate()
    }
  })

  it('DIRECTEUR_TECHNIQUE sans MFA verifie (AAL1) ne voit aucun ecran financier — meme role, session non elevee', async () => {
    const { client } = await signInAs('dt.demo@medfinder.test')
    const visible = await screens(client)
    expect(visible).toEqual({ tresorerie: false, budget: false, depenses: false, papej: false })
  })

  it('DG voit les fonctions de pilotage et validation (tresorerie, budget, depenses, PAPEJ) une fois AAL2 verifie', async () => {
    const { client, deElevate } = await signInAsElevated('dg.demo@medfinder.test')
    try {
      const visible = await screens(client)
      expect(visible).toEqual({ tresorerie: true, budget: true, depenses: true, papej: true })
    } finally {
      await deElevate()
    }
  })

  it('DG sans MFA verifie (AAL1) ne voit aucun ecran financier — meme role, session non elevee', async () => {
    const { client } = await signInAs('dg.demo@medfinder.test')
    const visible = await screens(client)
    expect(visible).toEqual({ tresorerie: false, budget: false, depenses: false, papej: false })
  })
})
