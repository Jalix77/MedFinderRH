import { test, expect } from '@playwright/test'
import { loginAs } from './helpers'
import { createIssuedInvoice, createCustomerThirdParty } from './fixtures'

// pdf-parse v2 (API classe) — meme patron que papej-pdf-export.spec.ts.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PDFParse } = require('pdf-parse')

/**
 * Phase 2C.4 — exploitation fonctionnelle de la facturation.
 * Aucun moteur comptable n'est teste ici (couvert par 2C.3A/2C.3B) :
 * ces tests portent sur les ecrans, les permissions, l'IDOR et le PDF.
 */
test.describe('Phase 2C.4 — Ecrans facturation et tiers', () => {
  test('liste des tiers : recherche et fiche accessible', async ({ page }) => {
    const fixture = await createCustomerThirdParty(`ui-${Date.now()}`)
    try {
      await loginAs(page, 'comptable.demo@medfinder.test')
      await page.goto(`/tiers?q=${encodeURIComponent(fixture.legalName)}`)

      await expect(page.getByRole('heading', { name: 'Tiers' })).toBeVisible()
      const link = page.getByRole('link', { name: fixture.legalName })
      await expect(link).toBeVisible()

      await link.click()
      // waitForURL plutot que toHaveURL : la navigation serveur vers la
      // fiche (plusieurs requetes) depasse regulierement le timeout
      // d'assertion par defaut de 5 s. Meme correction que sur le lien
      // « Modifier » plus bas dans ce fichier.
      await page.waitForURL(new RegExp(`/tiers/${fixture.id}$`), { timeout: 30000 })
      await expect(page.getByRole('heading', { name: fixture.legalName })).toBeVisible()
      await expect(page.getByText(fixture.code)).toBeVisible()
    } finally {
      await fixture.cleanup()
    }
  })

  test('liste des factures : filtre par numero, montants et statut affiches', async ({ page }) => {
    const fixture = await createIssuedInvoice(`list-${Date.now()}`, 1500)
    try {
      await loginAs(page, 'comptable.demo@medfinder.test')
      await page.goto(`/facturation?q=${encodeURIComponent(fixture.documentNumber)}`)

      const row = page.locator('tr', { hasText: fixture.documentNumber })
      await expect(row).toBeVisible()
      await expect(row.getByText('Emise')).toBeVisible()
      // Montant documentaire affiche. `\s` couvre l'espace fine insecable
      // (U+202F) produite par Intl.NumberFormat en fr-FR — un espace
      // litteral ne correspondrait pas.
      //
      // DEUX cellules portent ce montant, et c'est precisement l'invariant
      // attendu : sur une facture emise et non encaissee, le total et le
      // reste a payer sont egaux.
      await expect(row.getByText(/1\s?500,00/)).toHaveCount(2)
      // Colonne « Paye » ciblee par sa POSITION : un filtre textuel sur
      // "0,00" capturerait aussi "1 500,00".
      const paidCell = row.locator('td').nth(6)
      await expect(paidCell).toContainText('0,00')
      await expect(paidCell).not.toContainText('500')
    } finally {
      await fixture.cleanup()
    }
  })

  test('detail facture : lignes, solde, statut et tracabilite comptable', async ({ page }) => {
    const fixture = await createIssuedInvoice(`detail-${Date.now()}`, 900)
    try {
      await loginAs(page, 'comptable.demo@medfinder.test')
      await page.goto(`/facturation/${fixture.invoiceId}`)

      await expect(page.getByRole('heading', { name: new RegExp(fixture.documentNumber) })).toBeVisible()
      await expect(page.getByText('Reste a payer')).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Lignes' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Encaissements' })).toBeVisible()
      // L'ecriture d'origine generee en 2C.3A doit etre visible.
      await expect(page.getByRole('heading', { name: 'Ecritures comptables liees' })).toBeVisible()
      await expect(page.getByText("Ecriture d'origine")).toBeVisible()
    } finally {
      await fixture.cleanup()
    }
  })

  test('creation d\'un brouillon via l\'ecran, puis edition', async ({ page }) => {
    const customer = await createCustomerThirdParty(`draft-${Date.now()}`)
    try {
      await loginAs(page, 'comptable.demo@medfinder.test')
      await page.goto('/facturation/nouvelle')

      await page.getByLabel('Client').selectOption({ label: `${customer.code} — ${customer.legalName}` })
      await page.getByLabel('Description ligne 1').fill('Prestation E2E')
      await page.getByLabel('Quantite ligne 1').fill('2')
      await page.getByLabel('Prix unitaire ligne 1').fill('250')
      await page.getByLabel('Compte de produit ligne 1').selectOption({ index: 1 })

      await page.getByRole('button', { name: 'Creer le brouillon' }).click()
      await page.waitForURL(/\/facturation\/[0-9a-f-]{36}$/, { timeout: 30000 })

      // Un brouillon n'a pas de numero et affiche les actions de workflow.
      await expect(page.getByRole('heading', { name: /\(brouillon\)/ })).toBeVisible()
      await expect(page.getByText('Prestation E2E')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Soumettre' })).toBeVisible()

      // Edition du brouillon.
      await page.getByRole('link', { name: 'Modifier' }).click()
      // waitForURL plutot que toHaveURL : la navigation serveur peut
      // depasser le timeout d'assertion par defaut (5 s) sous charge.
      await page.waitForURL(/\/modifier$/, { timeout: 30000 })
      await page.getByLabel('Description ligne 1').fill('Prestation E2E modifiee')
      await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click()
      await page.waitForURL(/\/facturation\/[0-9a-f-]{36}$/, { timeout: 30000 })
      await expect(page.getByText('Prestation E2E modifiee')).toBeVisible()

      // Nettoyage : le brouillon est supprimable (aucune ecriture generee).
      await page.getByRole('button', { name: 'Supprimer le brouillon' }).click()
      await page.waitForURL(/\/facturation$/, { timeout: 30000 })
    } finally {
      await customer.cleanup()
    }
  })

  test('PDF facture : genere, valide, et contient les donnees essentielles', async ({ page }) => {
    const fixture = await createIssuedInvoice(`pdf-${Date.now()}`, 1234)
    try {
      await loginAs(page, 'comptable.demo@medfinder.test')
      const response = await page.request.get(`/api/facturation/${fixture.invoiceId}/pdf`)

      expect(response.status()).toBe(200)
      expect(response.headers()['content-type']).toBe('application/pdf')
      expect(response.headers()['content-disposition']).toContain('attachment')

      const buffer = await response.body()
      expect(buffer.byteLength).toBeGreaterThan(500)

      const parsed = await new PDFParse({ data: buffer }).getText()
      const textContent = parsed.text as string
      expect(textContent).toContain('FACTURE')
      expect(textContent).toContain(fixture.documentNumber)
      expect(textContent).toContain(fixture.customerName)
      expect(textContent).toContain('Reste a payer')
      expect(textContent).toContain('Genere le')
    } finally {
      await fixture.cleanup()
    }
  })

  test('permission : un role sans droit de facturation ne voit ni les ecrans ni le PDF', async ({ page }) => {
    const fixture = await createIssuedInvoice(`perm-${Date.now()}`, 400)
    try {
      // RH n'a ni invoice.manage ni accounting.view ni customer/supplier.manage.
      await loginAs(page, 'rh.demo@medfinder.test')

      await page.goto('/facturation')
      await expect(page.getByRole('heading', { name: 'Acces refuse' })).toBeVisible()

      await page.goto('/tiers')
      await expect(page.getByRole('heading', { name: 'Acces refuse' })).toBeVisible()

      await page.goto(`/facturation/${fixture.invoiceId}`)
      await expect(page.getByRole('heading', { name: 'Acces refuse' })).toBeVisible()
      expect(await page.locator('body').innerText()).not.toContain(fixture.documentNumber)

      // Le PDF ne doit fuiter aucun contenu : la RLS ne renvoie rien -> 404.
      const pdf = await page.request.get(`/api/facturation/${fixture.invoiceId}/pdf`)
      expect(pdf.status()).toBe(404)
      expect(await pdf.text()).not.toContain(fixture.customerName)
    } finally {
      await fixture.cleanup()
    }
  })

  test('IDOR : un acteur d\'Org B n\'accede ni au document ni a son PDF', async ({ page }) => {
    const fixture = await createIssuedInvoice(`idor-${Date.now()}`, 700)
    try {
      await loginAs(page, 'orgb.demo@medfinder.test')

      await page.goto(`/facturation/${fixture.invoiceId}`)
      await expect(page.getByRole('heading', { name: 'Acces refuse' })).toBeVisible()
      expect(await page.locator('body').innerText()).not.toContain(fixture.documentNumber)

      const pdf = await page.request.get(`/api/facturation/${fixture.invoiceId}/pdf`)
      expect(pdf.status(), 'aucun PDF d\'une autre organisation').toBe(404)

      await page.goto(`/tiers/${fixture.customerId}`)
      await expect(page.getByRole('heading', { name: 'Acces refuse' })).toBeVisible()
    } finally {
      await fixture.cleanup()
    }
  })

  test('un document emis n\'est pas modifiable depuis l\'ecran', async ({ page }) => {
    const fixture = await createIssuedInvoice(`immu-${Date.now()}`, 550)
    try {
      await loginAs(page, 'comptable.demo@medfinder.test')
      await page.goto(`/facturation/${fixture.invoiceId}/modifier`)

      await expect(page.getByRole('heading', { name: 'Modification impossible' })).toBeVisible()
      await expect(page.getByText(/contenu financier est definitivement fige/)).toBeVisible()
    } finally {
      await fixture.cleanup()
    }
  })
})
