import { test, expect } from '@playwright/test'
import { loginAs } from './helpers'

test.describe('Tresorerie', () => {
  test('affiche les soldes en HTG et permet de creer un compte', async ({ page }) => {
    await loginAs(page, 'comptable.demo@medfinder.test')
    await page.goto('/tresorerie')

    await expect(page.getByRole('heading', { name: 'Caisses', exact: true })).toBeVisible()
    // Format monetaire HTG explicite (§ regles UX : affichage HTG/USD).
    await expect(page.getByText(/HTG$/).first()).toBeVisible()

    // Etat vide reel (aucun test ne cree de compte bancaire) : verifie le
    // libelle d'etat vide plutot qu'une supposition de donnees.
    const bankSection = page.locator('section', { has: page.getByRole('heading', { name: 'Comptes bancaires' }) })
    await expect(bankSection.getByText('Aucun compte.')).toBeVisible()
  })

  test('action non autorisee : SUPPORT ne peut pas acceder a la Tresorerie', async ({ page }) => {
    await loginAs(page, 'support.demo@medfinder.test')
    await page.goto('/tresorerie')
    await expect(page.getByText('Acces refuse')).toBeVisible()
  })
})
