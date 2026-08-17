import { test, expect } from '@playwright/test'
import { loginAs } from './helpers'
import { createGrant, createBudgetWithTwoLines, getOrgAId } from './fixtures'
import { createClient } from '@supabase/supabase-js'
import { tag } from '../support/fixture-registry'

// pdf-parse v2 (API classe, differente de la fonction v1 documentee dans la
// plupart des exemples en ligne — verifie contre node_modules/pdf-parse/README.md
// installe reellement ici) : require direct, coherent avec le reste des
// fixtures E2E (voir tests/e2e/fixtures.ts).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PDFParse } = require('pdf-parse')

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
  const grantFixture = await createGrant(label)
  const budgetFixture = await createBudgetWithTwoLines(label)
  const admin = adminClient()
  const orgId = await getOrgAId()
  // Registre compose : nettoie tout ce que createGrant + createBudgetWithTwoLines
  // ont deja enregistre, PLUS les deux inserts supplementaires ci-dessous.
  const registry = grantFixture.registry
  registry.merge(budgetFixture.registry)

  const { data: link } = await admin
    .from('grant_budget_lines')
    .insert({
      organization_id: orgId,
      grant_id: grantFixture.grantId,
      budget_line_id: budgetFixture.lineA.id,
      category: budgetFixture.lineA.category,
    })
    .select('id')
    .single()
  registry.track('grant_budget_lines', link!.id as string)

  // Depense "committed" (visible dans le rapport, sans justificatif —
  // alimente la section anomalies) directement en base (admin), sans
  // passer par le workflow complet — suffisant pour verifier le contenu
  // du PDF, deja couvert ailleurs (expense-workflow.spec.ts) pour le
  // workflow lui-meme.
  const { data: expense } = await admin
    .from('expense_requests')
    .insert({
      organization_id: orgId,
      budget_line_id: budgetFixture.lineA.id,
      requester_id: (await admin.from('users').select('id').eq('full_name', 'Demo Manager').single()).data!.id,
      payee_name: tag(`Fournisseur PDF ${label}`),
      amount: 1234,
      payment_method: 'cash',
      status: 'committed',
    })
    .select('id')
    .single()
  registry.track('expense_requests', expense!.id as string)

  return {
    grantId: grantFixture.grantId,
    grantName: grantFixture.grantName,
    category: budgetFixture.lineA.category,
    registry,
    admin,
    cleanup: () => registry.cleanup(admin),
  }
}

test.describe('Export PDF PAPEJ', () => {
  test('generation reussie : PDF valide contenant les donnees essentielles (test de generation + contenu)', async ({ page }) => {
    const { grantId, grantName, category, registry, admin, cleanup } = await createGrantWithExpense(`pdfgen${Date.now()}`)
    try {
      await loginAs(page, 'comptable.demo@medfinder.test')

      const periodStart = `${new Date().getFullYear()}-01-01`
      const periodEnd = new Date().toISOString().slice(0, 10)
      const response = await page.request.get(
        `/api/papej/${grantId}/rapport-pdf?period_start=${periodStart}&period_end=${periodEnd}`
      )

      expect(response.status()).toBe(200)
      // generate_papej_report() (appelee par le Route Handler PDF) persiste
      // sa sortie dans grant_reports — a suivre avant nettoyage.
      await registry.trackDerivedFrom(admin, 'grant_reports', 'grant_id', [grantId])
      expect(response.headers()['content-type']).toBe('application/pdf')
      expect(response.headers()['content-disposition']).toContain('attachment')

      const buffer = await response.body()
      expect(buffer.byteLength).toBeGreaterThan(500) // un PDF minimal valide n'est jamais quelques octets

      const parser = new PDFParse({ data: buffer })
      const parsed = await parser.getText()
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
    } finally {
      await cleanup()
    }
  })

  test('permission : un role sans papej.report ne peut pas generer/telecharger le PDF (403, jamais le contenu)', async ({ page }) => {
    const { grantId, cleanup } = await createGrantWithExpense(`pdfperm${Date.now()}`)
    try {
      await loginAs(page, 'rh.demo@medfinder.test') // RH n'a jamais papej.report

      const response = await page.request.get(
        `/api/papej/${grantId}/rapport-pdf?period_start=2026-01-01&period_end=2026-12-31`
      )
      expect(response.status()).toBe(403)
      const body = await response.text()
      expect(body).not.toContain('MedFinder Demo') // aucune fuite de contenu dans le corps de la reponse de refus
    } finally {
      await cleanup()
    }
  })

  test('isolation organisation : un acteur d\'Org B ne peut pas generer le rapport d\'un financement d\'Org A', async ({ page }) => {
    const { grantId, cleanup } = await createGrantWithExpense(`pdfiso${Date.now()}`)
    try {
      await loginAs(page, 'orgb.demo@medfinder.test')

      const response = await page.request.get(
        `/api/papej/${grantId}/rapport-pdf?period_start=2026-01-01&period_end=2026-12-31`
      )
      expect(response.status()).toBe(403)
    } finally {
      await cleanup()
    }
  })

  test('parametres invalides : dates manquantes ou mal formees refusees explicitement (jamais un plantage serveur)', async ({ page }) => {
    const { grantId, cleanup } = await createGrantWithExpense(`pdfvalid${Date.now()}`)
    try {
      await loginAs(page, 'comptable.demo@medfinder.test')

      const missing = await page.request.get(`/api/papej/${grantId}/rapport-pdf`)
      expect(missing.status()).toBe(400)

      const malformed = await page.request.get(`/api/papej/${grantId}/rapport-pdf?period_start=not-a-date&period_end=2026-12-31`)
      expect(malformed.status()).toBe(400)
    } finally {
      await cleanup()
    }
  })
})
