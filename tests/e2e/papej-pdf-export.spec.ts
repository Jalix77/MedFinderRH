import { test, expect } from '@playwright/test'
import { loginAs } from './helpers'
import { createGrant, createBudgetWithTwoLines, getOrgAId } from './fixtures'
import { createClient } from '@supabase/supabase-js'

// pdf-parse n'a pas de types officiels a jour pour cet import — require
// direct, coherent avec le reste des fixtures E2E (voir tests/e2e/fixtures.ts).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse')

function adminClient() {
  if (typeof globalThis.WebSocket === 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    globalThis.WebSocket = require('ws')
  }
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/** Grant + une ligne budgetaire avec une depense rattachee, pour un contenu PDF non vide. */
async function createGrantWithExpense(label: string) {
  const { grantId, grantName } = await createGrant(label)
  const { lineA } = await createBudgetWithTwoLines(label)
  const admin = adminClient()
  const orgId = await getOrgAId()

  await admin.from('grant_budget_lines').insert({
    organization_id: orgId,
    grant_id: grantId,
    budget_line_id: lineA.id,
    category: lineA.category,
  })

  // Depense "committed" (visible dans le rapport, sans justificatif —
  // alimente la section anomalies) directement en base (admin), sans
  // passer par le workflow complet — suffisant pour verifier le contenu
  // du PDF, deja couvert ailleurs (expense-workflow.spec.ts) pour le
  // workflow lui-meme.
  await admin.from('expense_requests').insert({
    organization_id: orgId,
    budget_line_id: lineA.id,
    requester_id: (await admin.from('users').select('id').eq('full_name', 'Demo Manager').single()).data!.id,
    payee_name: `Fournisseur PDF ${label}`,
    amount: 1234,
    payment_method: 'cash',
    status: 'committed',
  })

  return { grantId, grantName, category: lineA.category }
}

test.describe('Export PDF PAPEJ', () => {
  test('generation reussie : PDF valide contenant les donnees essentielles (test de generation + contenu)', async ({ page }) => {
    const { grantId, grantName, category } = await createGrantWithExpense(`pdfgen${Date.now()}`)
    await loginAs(page, 'comptable.demo@medfinder.test')

    const periodStart = `${new Date().getFullYear()}-01-01`
    const periodEnd = new Date().toISOString().slice(0, 10)
    const response = await page.request.get(
      `/api/papej/${grantId}/rapport-pdf?period_start=${periodStart}&period_end=${periodEnd}`
    )

    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toBe('application/pdf')
    expect(response.headers()['content-disposition']).toContain('attachment')

    const buffer = await response.body()
    expect(buffer.byteLength).toBeGreaterThan(500) // un PDF minimal valide n'est jamais quelques octets

    const parsed = await pdfParse(buffer)
    const pdfText = parsed.text as string

    // Contenu essentiel exige (§ obligatoire) : organisation, financement,
    // periode, accorde/recu/engage/paye/disponible, ligne budgetaire,
    // beneficiaire, date de generation.
    expect(pdfText).toContain('MedFinder Demo')
    expect(pdfText).toContain(grantName)
    expect(pdfText).toContain(periodStart)
    expect(pdfText).toContain(periodEnd)
    expect(pdfText).toContain('Montant accorde')
    expect(pdfText).toContain('Montant recu')
    expect(pdfText).toContain('Engage')
    expect(pdfText).toContain('Paye')
    expect(pdfText).toContain('Disponible')
    expect(pdfText).toContain(category)
    expect(pdfText).toContain(`Fournisseur PDF`)
    expect(pdfText).toContain('Genere le')
    // La depense inseree est "committed" sans justificatif -> doit
    // apparaitre dans la section anomalies.
    expect(pdfText).toContain('Depenses sans justificatif')
  })

  test('permission : un role sans papej.report ne peut pas generer/telecharger le PDF (403, jamais le contenu)', async ({ page }) => {
    const { grantId } = await createGrantWithExpense(`pdfperm${Date.now()}`)
    await loginAs(page, 'rh.demo@medfinder.test') // RH n'a jamais papej.report

    const response = await page.request.get(
      `/api/papej/${grantId}/rapport-pdf?period_start=2026-01-01&period_end=2026-12-31`
    )
    expect(response.status()).toBe(403)
    const body = await response.text()
    expect(body).not.toContain('MedFinder Demo') // aucune fuite de contenu dans le corps de la reponse de refus
  })

  test('isolation organisation : un acteur d\'Org B ne peut pas generer le rapport d\'un financement d\'Org A', async ({ page }) => {
    const { grantId } = await createGrantWithExpense(`pdfiso${Date.now()}`)
    await loginAs(page, 'orgb.demo@medfinder.test')

    const response = await page.request.get(
      `/api/papej/${grantId}/rapport-pdf?period_start=2026-01-01&period_end=2026-12-31`
    )
    expect(response.status()).toBe(403)
  })

  test('parametres invalides : dates manquantes ou mal formees refusees explicitement (jamais un plantage serveur)', async ({ page }) => {
    const { grantId } = await createGrantWithExpense(`pdfvalid${Date.now()}`)
    await loginAs(page, 'comptable.demo@medfinder.test')

    const missing = await page.request.get(`/api/papej/${grantId}/rapport-pdf`)
    expect(missing.status()).toBe(400)

    const malformed = await page.request.get(`/api/papej/${grantId}/rapport-pdf?period_start=not-a-date&period_end=2026-12-31`)
    expect(malformed.status()).toBe(400)
  })
})
