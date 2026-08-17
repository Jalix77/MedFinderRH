import { test, expect } from '@playwright/test'
import { loginAs } from './helpers'
import { createGrant } from './fixtures'

test.describe('PAPEJ', () => {
  test('genere un rapport (etat vide honnete) et propose l\'export CSV', async ({ page }) => {
    const { grantId, registry, admin, cleanup } = await createGrant(`report${Date.now()}`)
    try {
      await loginAs(page, 'comptable.demo@medfinder.test')
      await page.goto(`/papej/${grantId}`)

      await expect(page.getByText('Accorde')).toBeVisible()
      await expect(page.getByText('850 000,00 HTG')).toBeVisible()
      // Aucune ligne budgetaire rattachee -> etat vide explicite, jamais
      // une valeur fictive a la place (§ criteres de cloture).
      await expect(page.getByText('Aucune ligne budgetaire.')).toBeVisible()

      await page.getByRole('button', { name: 'Generer le rapport' }).click()
      await expect(page.getByRole('button', { name: 'Exporter en CSV' })).toBeVisible({ timeout: 10000 })
      await expect(page.getByText('Aucune ligne PAPEJ pour cette periode.')).toBeVisible()

      // generate_papej_report() persiste sa sortie dans grant_reports.
      await registry.trackDerivedFrom(admin, 'grant_reports', 'grant_id', [grantId])
    } finally {
      await cleanup()
    }
  })

  test('action non autorisee : RH ne peut pas acceder a PAPEJ', async ({ page }) => {
    await loginAs(page, 'rh.demo@medfinder.test')
    await page.goto('/papej')
    await expect(page.getByText('Acces refuse')).toBeVisible()
  })
})
