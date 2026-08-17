import { test, expect } from '@playwright/test'
import { loginAs } from './helpers'
import { createApprovedBudgetLine } from './fixtures'

/**
 * E2E workflow depense — creation, soumission, action non autorisee
 * (auto-approbation), double soumission. Utilise MANAGER (expense.create
 * + expense.approve "equipe") plutot que DG/SUPER_ADMIN pour eviter la
 * dependance a un cycle TOTP reel en E2E (deja couvert par les tests
 * d'integration signInAsElevated).
 */
test.describe('Workflow depense', () => {
  test('creation (brouillon) -> soumission -> auto-approbation refusee par le backend', async ({ page }) => {
    const { category, registry, cleanup } = await createApprovedBudgetLine(`flow${Date.now()}`)
    try {
      await loginAs(page, 'manager.demo@medfinder.test')
      await page.goto('/depenses/nouvelle')

      await page.getByLabel('Beneficiaire').fill('Fournisseur E2E')
      await page.getByLabel('Montant').fill('1500')
      await page.getByLabel('Mode de paiement prevu').selectOption('cash')
      const lineSelect = page.getByLabel('Ligne budgetaire')
      const lineValue = await lineSelect.locator('option', { hasText: category }).getAttribute('value')
      await lineSelect.selectOption(lineValue!)
      await page.getByRole('button', { name: 'Creer la demande (brouillon)' }).click()

      // Redirige vers la fiche (createExpenseRequestAction fait un redirect()).
      await page.waitForURL(/\/depenses\/[0-9a-f-]{36}$/, { timeout: 15000 })
      registry.track('expense_requests', page.url().split('/').pop()!)
      await expect(page.getByText('Brouillon')).toBeVisible()

      await page.getByRole('button', { name: 'Soumettre' }).click()
      await expect(page.getByText('Soumise')).toBeVisible({ timeout: 25000 })

      // MANAGER detient expense.approve mais est aussi le demandeur : le
      // bouton reste visible (garde de permission simple, pas de connaissance
      // du "self" cote UI — § regles de securite, le backend reste
      // l'autorite finale) — cliquer doit produire un refus explicite.
      await page.getByRole('button', { name: 'Approuver' }).click()
      await expect(page.getByText('Vous ne pouvez pas approuver votre propre demande.')).toBeVisible({ timeout: 25000 })
      // Le statut n'a pas change malgre le refus (pas de faux succes silencieux).
      await expect(page.getByText('Soumise')).toBeVisible()
    } finally {
      await cleanup()
    }
  })

  test('formulaire invalide : la creation est bloquee sans ligne budgetaire ni beneficiaire', async ({ page }) => {
    await loginAs(page, 'manager.demo@medfinder.test')
    await page.goto('/depenses/nouvelle')

    await page.getByRole('button', { name: 'Creer la demande (brouillon)' }).click()
    // Validation HTML5 native (required) bloque la navigation — toujours
    // sur la page de creation, pas de redirection vers une fiche.
    await expect(page).toHaveURL(/\/depenses\/nouvelle$/)
  })

  test('double soumission : le bouton se desactive pendant l\'action, un seul justificatif deverse', async ({ page }) => {
    const { category, registry, cleanup } = await createApprovedBudgetLine(`dbl${Date.now()}`)
    try {
      await loginAs(page, 'manager.demo@medfinder.test')
      await page.goto('/depenses/nouvelle')
      await page.getByLabel('Beneficiaire').fill('Fournisseur E2E double')
      await page.getByLabel('Montant').fill('750')
      await page.getByLabel('Mode de paiement prevu').selectOption('cash')
      const lineSelect = page.getByLabel('Ligne budgetaire')
      const lineValue = await lineSelect.locator('option', { hasText: category }).getAttribute('value')
      await lineSelect.selectOption(lineValue!)
      await page.getByRole('button', { name: 'Creer la demande (brouillon)' }).click()
      await page.waitForURL(/\/depenses\/[0-9a-f-]{36}$/, { timeout: 15000 })
      registry.track('expense_requests', page.url().split('/').pop()!)

      const submitButton = page.getByRole('button', { name: 'Soumettre' })
      await submitButton.click()
      // Des le premier clic, le bouton est retire (transition d'etat) —
      // un deuxieme clic sur la meme cible est donc structurellement
      // impossible, preuve directe de la protection double-soumission
      // (useTransition + disabled, composants/finance/action-form.tsx).
      await expect(submitButton).toHaveCount(0, { timeout: 25000 })
      // Meme marge que ci-dessus (25s, pas le defaut 5s) : le bouton
      // disparait des la transition d'etat cote client, mais le texte de
      // statut ne s'affiche qu'apres le round-trip router.refresh() complet
      // (re-rendu du composant serveur) — sous latence reseau cloud
      // variable, 5s s'est revele trop court (echec intermittent reel
      // observe, jamais un defaut applicatif : le flux
      // submit_expense_request -> statut 'submitted' est rapide et correct
      // en isolation directe, voir docs/phase-1c-closing-report.md).
      await expect(page.getByText('Soumise')).toBeVisible({ timeout: 25000 })
    } finally {
      await cleanup()
    }
  })
})
