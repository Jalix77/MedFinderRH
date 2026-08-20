import { test, expect } from '@playwright/test'
import { loginAs } from './helpers'
import { createIssuedInvoice } from './fixtures'

/**
 * Phase 2C.5A — saisie d'un encaissement depuis l'UI.
 *
 * L'ecran n'est jamais l'autorite : ces tests verifient qu'il APPELLE
 * correctement record_customer_payment (deja valide en 2C.3B) et qu'il
 * restitue fidelement le resultat — succes comme refus.
 */
// Budget de temps releve POUR CE FICHIER UNIQUEMENT.
//
// Ce n'est pas un contournement d'instabilite : les logs du serveur
// montrent que recordCustomerPaymentAction s'execute en 206-443 ms.
// Le cout reel vient du NOMBRE d'etapes de ces scenarios — connexion,
// navigation vers la fiche (une dizaine d'allers-retours SQL sur le
// projet cloud partage), action serveur, puis router.refresh() qui
// re-rend la page entiere — parfois deux fois de suite pour un
// enchainement partiel -> final. Le budget global de 45 s, fixe en
// Phase 1C pour des pages bien plus simples, ne couvre pas ce cumul.
//
// Aucun timeout d'assertion individuel n'est gonfle : seul le budget
// TOTAL par test est ajuste a ce que le scenario coute reellement.
test.describe.configure({ timeout: 120000 })

test.describe('Phase 2C.5A — Encaissement depuis l\'UI', () => {
  test('paiement PARTIEL : statut partially_paid, solde et montant paye rafraichis', async ({ page }) => {
    const fixture = await createIssuedInvoice(`pay-partial-${Date.now()}`, 1000)
    try {
      await loginAs(page, 'comptable.demo@medfinder.test')
      await page.goto(`/facturation/${fixture.invoiceId}`)

      await expect(page.getByRole('heading', { name: 'Enregistrer un encaissement' })).toBeVisible()
      await expect(page.getByText(/Solde avant paiement/)).toBeVisible()

      await page.getByLabel('Compte de tresorerie').selectOption({ index: 1 })
      await page.getByLabel(/^Montant/).fill('400')
      await page.getByRole('button', { name: "Enregistrer l'encaissement" }).click()

      await expect(page.getByText('Encaissement enregistre.')).toBeVisible({ timeout: 30000 })

      // Statut et montants rafraichis depuis le serveur.
      await expect(page.getByText('Partiellement payee')).toBeVisible({ timeout: 30000 })
      await expect(
        page.getByText('Deja paye').locator('xpath=following-sibling::p')
      ).toContainText('400,00', { timeout: 30000 })
    } finally {
      await fixture.cleanup()
    }
  })

  test('paiement FINAL : passage a paid et solde nul', async ({ page }) => {
    const fixture = await createIssuedInvoice(`pay-final-${Date.now()}`, 500)
    try {
      await loginAs(page, 'comptable.demo@medfinder.test')
      await page.goto(`/facturation/${fixture.invoiceId}`)

      // Le montant est pre-rempli avec le solde restant.
      await page.getByLabel('Compte de tresorerie').selectOption({ index: 1 })
      await page.getByRole('button', { name: "Enregistrer l'encaissement" }).click()
      await expect(page.getByText('Encaissement enregistre.')).toBeVisible({ timeout: 30000 })

      await expect(page.getByText('Payee', { exact: true })).toBeVisible({ timeout: 30000 })
      // Le formulaire disparait : plus rien a encaisser.
      await expect(page.getByRole('heading', { name: 'Enregistrer un encaissement' })).toHaveCount(0)
    } finally {
      await fixture.cleanup()
    }
  })

  test('enchainement partiel puis final : partially_paid -> paid', async ({ page }) => {
    const fixture = await createIssuedInvoice(`pay-seq-${Date.now()}`, 900)
    try {
      await loginAs(page, 'comptable.demo@medfinder.test')
      await page.goto(`/facturation/${fixture.invoiceId}`)

      await page.getByLabel('Compte de tresorerie').selectOption({ index: 1 })
      await page.getByLabel(/^Montant/).fill('300')
      await page.getByRole('button', { name: "Enregistrer l'encaissement" }).click()
      await expect(page.getByText('Partiellement payee')).toBeVisible({ timeout: 30000 })

      // Second encaissement du solde restant.
      await page.getByLabel('Compte de tresorerie').selectOption({ index: 1 })
      await page.getByLabel(/^Montant/).fill('600')
      await page.getByRole('button', { name: "Enregistrer l'encaissement" }).click()
      await expect(page.getByText('Payee', { exact: true })).toBeVisible({ timeout: 30000 })

      // Les deux encaissements sont listes.
      await expect(page.locator('tr', { hasText: /ENC-/ })).toHaveCount(2)
    } finally {
      await fixture.cleanup()
    }
  })

  test('le refus du backend est affiche fidelement (montant superieur au solde)', async ({ page }) => {
    const fixture = await createIssuedInvoice(`pay-over-${Date.now()}`, 200)
    try {
      await loginAs(page, 'comptable.demo@medfinder.test')
      await page.goto(`/facturation/${fixture.invoiceId}`)

      await page.getByLabel('Compte de tresorerie').selectOption({ index: 1 })
      // L'attribut max est un confort de saisie : on le contourne pour
      // verifier que l'AUTORITE reste le backend.
      await page.getByLabel(/^Montant/).evaluate((el, v) => {
        const input = el as HTMLInputElement
        input.removeAttribute('max')
        input.value = v
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }, '999')
      await page.getByRole('button', { name: "Enregistrer l'encaissement" }).click()

      // getByRole('alert') heurterait l'annonceur de route de Next
      // (__next-route-announcer__) : on cible le message lui-meme.
      await expect(page.getByText(/depasse le solde restant/)).toBeVisible({ timeout: 30000 })
      // Aucun encaissement n'a ete cree.
      await expect(page.locator('tr', { hasText: /ENC-/ })).toHaveCount(0)
    } finally {
      await fixture.cleanup()
    }
  })

  test('aucune double soumission : le bouton se desactive pendant l\'appel', async ({ page }) => {
    const fixture = await createIssuedInvoice(`pay-double-${Date.now()}`, 800)
    try {
      await loginAs(page, 'comptable.demo@medfinder.test')
      await page.goto(`/facturation/${fixture.invoiceId}`)

      await page.getByLabel('Compte de tresorerie').selectOption({ index: 1 })
      await page.getByLabel(/^Montant/).fill('800')

      const button = page.getByRole('button', { name: "Enregistrer l'encaissement" })
      await button.click()
      // Pendant l'appel, le bouton est desactive : un second clic est
      // structurellement impossible.
      await expect(page.getByRole('button', { name: 'Enregistrement…' })).toBeDisabled()

      await expect(page.getByText('Payee', { exact: true })).toBeVisible({ timeout: 30000 })
      // Un seul encaissement malgre la tentative.
      await expect(page.locator('tr', { hasText: /ENC-/ })).toHaveCount(1)
    } finally {
      await fixture.cleanup()
    }
  })

  test('un BROUILLON ne propose aucun encaissement', async ({ page }) => {
    const fixture = await createIssuedInvoice(`pay-draft-${Date.now()}`, 300)
    try {
      const admin = fixture.admin
      // Nouveau brouillon pour le meme client.
      const { data: draft } = await admin
        .from('invoices')
        .insert({
          organization_id: fixture.orgId,
          third_party_id: fixture.customerId,
          document_date: new Date().toISOString().slice(0, 10),
          due_date: '2027-12-31',
        })
        .select('id')
        .single()
      fixture.registry.track('invoices', draft!.id as string)

      await loginAs(page, 'comptable.demo@medfinder.test')
      await page.goto(`/facturation/${draft!.id}`)

      await expect(page.getByRole('heading', { name: 'Enregistrer un encaissement' })).toHaveCount(0)
      await expect(page.getByText('Aucun encaissement enregistre pour ce document.')).toBeVisible()
    } finally {
      await fixture.cleanup()
    }
  })

  test('permission : un acteur sans payment.record ne voit pas le formulaire', async ({ page }) => {
    const fixture = await createIssuedInvoice(`pay-perm-${Date.now()}`, 450)
    try {
      // RH n'a aucune permission de facturation ni d'encaissement.
      await loginAs(page, 'rh.demo@medfinder.test')
      await page.goto(`/facturation/${fixture.invoiceId}`)

      await expect(page.getByRole('heading', { name: 'Acces refuse' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Enregistrer un encaissement' })).toHaveCount(0)
    } finally {
      await fixture.cleanup()
    }
  })

  test('IDOR : un acteur d\'Org B ne peut pas encaisser une facture d\'Org A', async ({ page }) => {
    const fixture = await createIssuedInvoice(`pay-idor-${Date.now()}`, 650)
    try {
      await loginAs(page, 'orgb.demo@medfinder.test')
      await page.goto(`/facturation/${fixture.invoiceId}`)

      await expect(page.getByRole('heading', { name: 'Acces refuse' })).toBeVisible()
      expect(await page.locator('body').innerText()).not.toContain(fixture.documentNumber)

      // Aucun encaissement cree cote base.
      const { data: payments } = await fixture.admin
        .from('customer_payments')
        .select('id')
        .eq('invoice_id', fixture.invoiceId)
      expect(payments ?? []).toEqual([])
    } finally {
      await fixture.cleanup()
    }
  })

  test('releve client : mouvements, soldes et coherence affiches', async ({ page }) => {
    const fixture = await createIssuedInvoice(`stmt-${Date.now()}`, 1200)
    try {
      await loginAs(page, 'comptable.demo@medfinder.test')

      // Un encaissement partiel via l'UI, puis consultation du releve.
      await page.goto(`/facturation/${fixture.invoiceId}`)
      await page.getByLabel('Compte de tresorerie').selectOption({ index: 1 })
      await page.getByLabel(/^Montant/).fill('500')
      await page.getByRole('button', { name: "Enregistrer l'encaissement" }).click()
      await expect(page.getByText('Partiellement payee')).toBeVisible({ timeout: 30000 })

      await page.goto(`/tiers/${fixture.customerId}/releve`)
      await expect(page.getByRole('heading', { name: /Releve client/ })).toBeVisible()
      // Ces libelles figurent DEUX fois (carte de synthese + ligne de
      // tableau) : c'est attendu, on verifie donc leur presence sans
      // exiger l'unicite.
      await expect(page.getByText("Solde d'ouverture").first()).toBeVisible()
      await expect(page.getByText('Solde de cloture').first()).toBeVisible()

      // La facture (debit) et l'encaissement (credit) figurent au releve.
      await expect(page.locator('tr', { hasText: fixture.documentNumber })).toBeVisible()
      await expect(page.locator('tr', { hasText: /ENC-/ })).toBeVisible()
    } finally {
      await fixture.cleanup()
    }
  })
})
