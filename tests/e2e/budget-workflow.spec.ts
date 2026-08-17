import { test, expect } from '@playwright/test'
import { loginAs } from './helpers'
import { createBudgetWithTwoLines } from './fixtures'

test.describe('Workflow budget', () => {
  test('affiche prevu/engage/disponible et transfere entre deux lignes', async ({ page }) => {
    const { budgetId, lineA, lineB, registry, admin, cleanup } = await createBudgetWithTwoLines(`t${Date.now()}`)
    try {
      await loginAs(page, 'comptable.demo@medfinder.test')
      await page.goto(`/budget/${budgetId}`)

      await expect(page.getByText('Lignes budgetaires')).toBeVisible()
      await expect(page.getByRole('cell', { name: lineA.category, exact: true })).toBeVisible({ timeout: 15000 })
      await expect(page.getByRole('cell', { name: lineB.category, exact: true })).toBeVisible()
      // Libelles metier attendus (§ regles UX) — pas de nom de colonne brut.
      await expect(page.getByRole('columnheader', { name: 'Prevu' })).toBeVisible()
      await expect(page.getByRole('columnheader', { name: 'Engage' })).toBeVisible()
      await expect(page.getByRole('columnheader', { name: 'Disponible' })).toBeVisible()

      await page.getByLabel('De la ligne').selectOption({ label: lineA.category })
      await page.getByLabel('Vers la ligne').selectOption({ label: lineB.category })
      // "Montant" seul est ambigu (present aussi dans le formulaire "Nouvelle
      // ligne" via "Montant planifie", techniquement dans le DOM meme replie
      // dans son <details>) — cible l'id specifique du formulaire de transfert.
      await page.locator('#transfer_amount').fill('5000')
      await page.getByLabel('Justification').fill('Reequilibrage E2E')
      await page.getByRole('button', { name: 'Transferer' }).click()

      await expect(page.getByText('Transfert effectue.')).toBeVisible({ timeout: 10000 })

      // Le transfert cree une ligne budget_transfers (FK on delete restrict
      // vers budget_id/from_line_id/to_line_id) — doit etre suivie et
      // supprimee AVANT le budget/les lignes, sinon cleanup() echoue.
      await registry.trackDerivedFrom(admin, 'budget_transfers', 'budget_id', [budgetId])
    } finally {
      await cleanup()
    }
  })

  test('action non autorisee : EMPLOYE ne peut pas acceder a la page Budget', async ({ page }) => {
    await loginAs(page, 'employe.demo@medfinder.test')
    await page.goto('/budget')
    await expect(page.getByText('Acces refuse')).toBeVisible()
  })
})
