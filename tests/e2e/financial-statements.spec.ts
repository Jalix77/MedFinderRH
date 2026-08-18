import fs from 'node:fs'
import { test, expect } from '@playwright/test'
import { loginAs } from './helpers'
import { createPostedJournalEntry } from './fixtures'

// pdf-parse v2 (API classe) — meme patron que tests/e2e/papej-pdf-export.spec.ts.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PDFParse } = require('pdf-parse')

/** Extrait la valeur numerique d'un montant formatte (fr-FR, formatMoney) — voir lib/format/money.ts. */
function parseMoney(raw: string): number {
  const numeric = raw.replace(/[^0-9,-]/g, '')
  return Number(numeric.replace(',', '.'))
}

test.describe('Phase 2B — Etats financiers (UI + exports)', () => {
  test('journal general : ecran et PDF affichent la meme ecriture comptabilisee', async ({ page }) => {
    const label = `journal${Date.now()}`
    const fixture = await createPostedJournalEntry(label, 24681)
    try {
      await loginAs(page, 'comptable.demo@medfinder.test')
      await page.goto(
        `/comptabilite/rapports?type=journal-general&period_start=${fixture.periodStart}&period_end=${fixture.periodEnd}`
      )

      const bodyText = await page.locator('body').innerText()
      expect(bodyText).toContain(fixture.debitAccount.label)
      expect(bodyText).toContain(fixture.creditAccount.label)

      const response = await page.request.get(
        `/api/comptabilite/rapports?type=journal-general&period_start=${fixture.periodStart}&period_end=${fixture.periodEnd}`
      )
      expect(response.status()).toBe(200)
      expect(response.headers()['content-type']).toBe('application/pdf')
      const buffer = await response.body()
      expect(buffer.byteLength).toBeGreaterThan(500)

      const parser = new PDFParse({ data: buffer })
      const parsed = await parser.getText()
      expect(parsed.text).toContain(fixture.debitAccount.label)
      expect(parsed.text).toContain(fixture.creditAccount.label)
    } finally {
      await fixture.cleanup()
    }
  })

  test('export CSV : le fichier telecharge contient les memes donnees que l\'ecran', async ({ page }) => {
    const label = `csv${Date.now()}`
    const fixture = await createPostedJournalEntry(label, 13579)
    try {
      await loginAs(page, 'comptable.demo@medfinder.test')
      await page.goto(
        `/comptabilite/rapports?type=journal-general&period_start=${fixture.periodStart}&period_end=${fixture.periodEnd}`
      )

      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'Exporter en CSV' }).click(),
      ])
      const path = await download.path()
      expect(path).toBeTruthy()
      const content = fs.readFileSync(path!, 'utf-8')
      expect(content).toContain(fixture.debitAccount.label)
      expect(content).toContain(fixture.creditAccount.label)
    } finally {
      await fixture.cleanup()
    }
  })

  test('bilan : Total Actif = Total Passif + Capitaux Propres + Resultat non affecte (invariant verifie automatiquement)', async ({
    page,
  }) => {
    const label = `bilan${Date.now()}`
    const fixture = await createPostedJournalEntry(label, 9999)
    try {
      await loginAs(page, 'comptable.demo@medfinder.test')
      await page.goto(`/comptabilite/rapports?type=bilan&fiscal_year_id=${fixture.fiscalYearId}&as_of_date=${fixture.periodEnd}`)

      const actifRow = page.getByText('Total Actif', { exact: true }).locator('xpath=..')
      const passifRow = page
        .getByText('Total Passif + Capitaux Propres + Resultat non affecte', { exact: true })
        .locator('xpath=..')
      await expect(actifRow).toBeVisible()
      await expect(passifRow).toBeVisible()

      const actifText = await actifRow.innerText()
      const passifText = await passifRow.innerText()
      const actifValue = parseMoney(actifText.replace('Total Actif', ''))
      const passifValue = parseMoney(passifText.replace('Total Passif + Capitaux Propres + Resultat non affecte', ''))
      expect(Math.abs(actifValue - passifValue)).toBeLessThan(0.01)
    } finally {
      await fixture.cleanup()
    }
  })

  test('permission : un role sans accounting.view ne voit ni la page ni ne peut telecharger le PDF', async ({ page }) => {
    const label = `perm${Date.now()}`
    const fixture = await createPostedJournalEntry(label, 4242)
    try {
      await loginAs(page, 'rh.demo@medfinder.test') // RH n'a jamais accounting.view

      await page.goto(
        `/comptabilite/rapports?type=journal-general&period_start=${fixture.periodStart}&period_end=${fixture.periodEnd}`
      )
      await expect(page.getByRole('heading', { name: 'Acces refuse' })).toBeVisible()
      const bodyText = await page.locator('body').innerText()
      expect(bodyText).not.toContain(fixture.debitAccount.label)

      const response = await page.request.get(
        `/api/comptabilite/rapports?type=journal-general&period_start=${fixture.periodStart}&period_end=${fixture.periodEnd}`
      )
      expect(response.status()).toBe(403)
      const body = await response.text()
      expect(body).not.toContain(fixture.debitAccount.label)
    } finally {
      await fixture.cleanup()
    }
  })

  test('parametres invalides : type de rapport inconnu refuse explicitement (jamais un plantage serveur)', async ({ page }) => {
    await loginAs(page, 'comptable.demo@medfinder.test')
    const response = await page.request.get('/api/comptabilite/rapports?type=inexistant')
    expect(response.status()).toBe(400)
  })
})
