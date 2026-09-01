import { test, expect } from '@playwright/test'
import { loginAs } from './helpers'
import { createTreasuryAccountWithMovement, cleanupBankStatementImport } from './fixtures'

/**
 * Phase 2D — rapprochement bancaire depuis l'UI.
 *
 * L'ecran n'est jamais l'autorite : ces tests verifient qu'il APPELLE
 * correctement les RPC deja validees par tests/integration/
 * bank-reconciliation.test.ts (43/43) et qu'il restitue fidelement leur
 * resultat. Aucune regle de rapprochement n'est reverifiee ici — seul le
 * parcours reel navigateur l'est.
 *
 * Budget de temps releve POUR CE FICHIER, meme raison qu'en 2C.5A
 * (payment-ui.spec.ts) : le cout vient du NOMBRE d'etapes — connexion,
 * import, action serveur, puis router.refresh() qui re-rend une page
 * portant le rapport de rapprochement complet. Aucun timeout d'assertion
 * individuel n'est gonfle pour masquer une lenteur.
 */
test.describe.configure({ timeout: 120000 })

/** Une seule ligne, montant et date identiques au mouvement : le cas ou
 *  le rapprochement automatique doit emettre exactement une proposition. */
function csvOneLine(date: string, amount: number) {
  return [
    'date,libelle,reference,debit,credit',
    `${date},Depot guichet,REF-E2E,,${amount.toFixed(2)}`,
  ].join('\n')
}

test.describe('Phase 2D — Rapprochement depuis l\'UI', () => {
  test('cycle complet : import CSV, proposition automatique, puis annulation motivee', async ({ page }) => {
    const valueDate = '2026-04-15'
    const fixture = await createTreasuryAccountWithMovement(`e2e-${Date.now()}`, {
      amount: 1250,
      date: valueDate,
    })
    let importId: string | null = null

    try {
      await loginAs(page, 'comptable.demo@medfinder.test')

      // --- Ecran d'import ---
      await page.goto('/tresorerie/rapprochement/importer')
      await expect(page.getByRole('heading', { name: 'Importer un releve' })).toBeVisible()

      await page.getByLabel('Compte de tresorerie').selectOption({ label: `Caisse — ${fixture.accountName} (HTG)` })
      await page.getByLabel('Reference du releve').fill(`E2E ${Date.now()}`)
      await page.getByLabel('Periode du').fill('2026-04-01')
      await page.getByLabel('au', { exact: true }).fill('2026-04-30')
      await page.getByLabel('Solde de cloture du releve').fill('1250')

      await page.getByLabel('Fichier du releve (CSV)').setInputFiles({
        name: 'releve-e2e.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csvOneLine(valueDate, 1250), 'utf-8'),
      })

      // La normalisation se fait dans le navigateur : la previsualisation
      // prouve que le CSV a ete lu et interprete avant tout envoi.
      await expect(page.getByText(/ligne\(s\) exploitable\(s\)/)).toBeVisible()
      await expect(page.getByRole('button', { name: 'Importer 1 ligne(s)' })).toBeEnabled()
      await page.getByRole('button', { name: 'Importer 1 ligne(s)' }).click()

      // --- Ecran de rapprochement ---
      await page.waitForURL(/\/tresorerie\/rapprochement\/[0-9a-f-]{36}$/, { timeout: 30000 })
      importId = page.url().split('/').pop()!

      // Solde comptable et solde releve sont restitues cote a cote, sans
      // que l'un soit recalcule a partir de l'autre.
      await expect(page.getByRole('heading', { name: 'Solde comptable vs solde releve' })).toBeVisible()
      await expect(page.getByText('Solde comptable de cloture')).toBeVisible()
      await expect(page.getByText('Solde du releve')).toBeVisible()

      const lineRow = page.getByRole('row').filter({ hasText: 'Depot guichet' })
      await expect(lineRow).toBeVisible()
      await expect(lineRow.getByText('Non rapproche')).toBeVisible()

      // --- Proposition automatique ---
      await page.getByRole('button', { name: 'Proposer les rapprochements automatiques' }).click()
      await expect(lineRow.getByText('Propose')).toBeVisible({ timeout: 30000 })

      // --- Annulation motivee ---
      await page.getByText('Annuler cet import').click()
      await page.getByPlaceholder('Motif').first().fill('Releve remplace par le correctif banque')
      await page.getByRole('button', { name: "Confirmer l'annulation" }).click()

      // L'import passe a Annule ET la proposition en attente est
      // neutralisee : la ligne redevient non rapprochee, elle ne reste pas
      // bloquee dans un statut intermediaire.
      await expect(page.getByText('Annule', { exact: true })).toBeVisible({ timeout: 30000 })
      await expect(lineRow.getByText('Non rapproche')).toBeVisible({ timeout: 30000 })
    } finally {
      if (importId) await cleanupBankStatementImport(importId)
      await fixture.cleanup()
    }
  })

  test('la liste des releves affiche l\'import et le filtre par reference le retrouve', async ({ page }) => {
    const reference = `E2E-LISTE-${Date.now()}`
    const fixture = await createTreasuryAccountWithMovement(`liste-${Date.now()}`, {
      amount: 640,
      date: '2026-04-20',
    })
    let importId: string | null = null

    try {
      await loginAs(page, 'comptable.demo@medfinder.test')

      await page.goto('/tresorerie/rapprochement/importer')
      await page.getByLabel('Compte de tresorerie').selectOption({ label: `Caisse — ${fixture.accountName} (HTG)` })
      await page.getByLabel('Reference du releve').fill(reference)
      await page.getByLabel('Periode du').fill('2026-04-01')
      await page.getByLabel('au', { exact: true }).fill('2026-04-30')
      await page.getByLabel('Fichier du releve (CSV)').setInputFiles({
        name: 'releve-liste.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csvOneLine('2026-04-20', 640), 'utf-8'),
      })
      await page.getByRole('button', { name: 'Importer 1 ligne(s)' }).click()

      await page.waitForURL(/\/tresorerie\/rapprochement\/[0-9a-f-]{36}$/, { timeout: 30000 })
      importId = page.url().split('/').pop()!

      await page.goto(`/tresorerie/rapprochement?q=${encodeURIComponent(reference)}`)
      await expect(page.getByRole('link', { name: reference })).toBeVisible({ timeout: 30000 })
    } finally {
      if (importId) await cleanupBankStatementImport(importId)
      await fixture.cleanup()
    }
  })
})
