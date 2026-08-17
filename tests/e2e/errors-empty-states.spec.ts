import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { loginAs } from './helpers'
import { createGrant } from './fixtures'
import { FixtureRegistry, tag } from '../support/fixture-registry'

function adminClient() {
  if (typeof globalThis.WebSocket === 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    globalThis.WebSocket = require('ws')
  }
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

test.describe('Erreurs, etats vides et coherence UI/backend', () => {
  test('une ressource inexistante affiche Acces refuse, jamais une page cassee', async ({ page }) => {
    await loginAs(page, 'comptable.demo@medfinder.test')
    await page.goto('/depenses/00000000-0000-0000-0000-000000000000')
    await expect(page.getByText('Acces refuse')).toBeVisible()
  })

  test('le montant accorde affiche a l\'ecran correspond exactement a la valeur en base (aucune valeur fictive)', async ({ page }) => {
    const { grantId, grantName, cleanup } = await createGrant(`consist${Date.now()}`)
    try {
      const admin = adminClient()
      const { data: grant } = await admin.from('grants').select('amount_granted, amount_received').eq('id', grantId).single()

      await loginAs(page, 'comptable.demo@medfinder.test')
      await page.goto(`/papej/${grantId}`)

      await expect(page.getByRole('heading', { name: grantName })).toBeVisible()
      const expectedGranted = Number(grant!.amount_granted).toLocaleString('fr-FR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
      const expectedReceived = Number(grant!.amount_received).toLocaleString('fr-FR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
      await expect(page.getByText(`${expectedGranted} HTG`)).toBeVisible()
      // "Recu"/"Engage"/"Disponible" peuvent tous afficher "0,00 HTG" pour un
      // financement fraichement cree — on lit directement le paragraphe-valeur
      // qui suit immediatement le libelle "Recu" (structure MetricCard),
      // plutot qu'un texte global ambigu (evite une violation de mode strict).
      const receivedValue = page.locator('p', { hasText: 'Recu' }).locator('xpath=following-sibling::p[1]')
      await expect(receivedValue).toHaveText(`${expectedReceived} HTG`)
    } finally {
      await cleanup()
    }
  })

  test('budget fraichement cree : etat vide honnete (aucune ligne), pas un tableau vide sans explication', async ({ page }) => {
    const admin = adminClient()
    const registry = new FixtureRegistry()
    try {
      const orgResp = await admin.from('organizations').select('id').eq('name', 'MedFinder Demo — Organisation A').single()
      const { data: fy } = await admin
        .from('fiscal_years')
        .insert({ organization_id: orgResp.data!.id, label: tag(`E2E-empty-${Date.now()}`), start_date: '2033-01-01', end_date: '2033-12-31' })
        .select('id')
        .single()
      registry.track('fiscal_years', fy!.id as string)
      const { data: budget } = await admin
        .from('budgets')
        .insert({ organization_id: orgResp.data!.id, fiscal_year_id: fy!.id, name: tag(`Budget E2E vide ${Date.now()}`) })
        .select('id')
        .single()
      registry.track('budgets', budget!.id as string)

      await loginAs(page, 'comptable.demo@medfinder.test')
      await page.goto(`/budget/${budget!.id}`)
      await expect(page.getByText('Aucune ligne budgetaire.')).toBeVisible()
      await expect(page.getByText('Aucun engagement actif.')).toBeVisible()
    } finally {
      await registry.cleanup(admin)
    }
  })
})
