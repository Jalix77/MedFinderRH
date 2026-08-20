import { createClient } from '@/lib/supabase/server'
import { buildInvoicePdf, type InvoicePdfData } from '@/lib/pdf/invoice-document'

/**
 * Export PDF d'une facture ou d'un avoir (Phase 2C.4).
 *
 * Autorisation entierement portee par la RLS : la lecture s'effectue sous
 * la session de l'utilisateur (createClient serveur), donc un document
 * d'une autre organisation, ou un acteur sans invoice.manage /
 * accounting.view, ne recoit tout simplement AUCUNE ligne -> 404, jamais
 * une fuite de contenu. Aucun filtre organisationnel n'est reimplemente
 * ici : ce serait une seconde autorite, contraire au principe pose depuis
 * la Phase 1C.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const supabase = await createClient()

  const { data: doc } = await supabase
    .from('invoices')
    .select(
      'id, organization_id, document_type, document_number, status, document_date, due_date, currency, exchange_rate_to_htg, external_reference, notes, credit_reason, credited_invoice_id, subtotal, tax_total, total, total_htg, amount_paid, balance_due, third_party_id'
    )
    .eq('id', id)
    .maybeSingle()

  if (!doc) {
    return new Response('Document introuvable ou acces refuse.', { status: 404 })
  }

  const [{ data: org }, { data: tp }, { data: lines }, { data: payments }, { data: credited }] = await Promise.all([
    supabase.from('organizations').select('name').eq('id', doc.organization_id).maybeSingle(),
    supabase.from('third_parties').select('legal_name, tax_id').eq('id', doc.third_party_id).maybeSingle(),
    supabase
      .from('invoice_lines')
      .select('description, quantity, unit_price, tax_rate_percent, line_subtotal, tax_amount, line_total')
      .eq('invoice_id', id)
      .order('line_number'),
    supabase
      .from('customer_payments')
      .select('payment_number, payment_date, amount, status')
      .eq('invoice_id', id)
      .order('payment_date'),
    doc.credited_invoice_id
      ? supabase.from('invoices').select('document_number').eq('id', doc.credited_invoice_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const payload: InvoicePdfData = {
    organizationName: org?.name ?? 'MedFinder Gestion',
    documentType: doc.document_type === 'CREDIT_NOTE' ? 'CREDIT_NOTE' : 'INVOICE',
    documentNumber: doc.document_number,
    status: doc.status,
    documentDate: doc.document_date,
    dueDate: doc.due_date,
    currency: doc.currency,
    exchangeRateToHtg: Number(doc.exchange_rate_to_htg),
    externalReference: doc.external_reference,
    notes: doc.notes,
    creditReason: doc.credit_reason,
    creditedDocumentNumber: (credited as { document_number?: string } | null)?.document_number ?? null,
    thirdPartyName: tp?.legal_name ?? '(tiers inconnu)',
    thirdPartyTaxId: tp?.tax_id ?? null,
    lines: (lines ?? []).map((l) => ({
      description: l.description,
      quantity: Number(l.quantity),
      unit_price: Number(l.unit_price),
      tax_rate_percent: Number(l.tax_rate_percent),
      line_subtotal: Number(l.line_subtotal ?? 0),
      tax_amount: Number(l.tax_amount ?? 0),
      line_total: Number(l.line_total ?? 0),
    })),
    subtotal: Number(doc.subtotal),
    taxTotal: Number(doc.tax_total),
    total: Number(doc.total),
    totalHtg: Number(doc.total_htg ?? 0),
    amountPaid: Number(doc.amount_paid),
    balanceDue: Number(doc.balance_due ?? 0),
    payments: (payments ?? []).map((p) => ({
      payment_number: p.payment_number,
      payment_date: p.payment_date,
      amount: Number(p.amount),
      status: p.status,
    })),
  }

  const bytes = await buildInvoicePdf(payload, new Date())
  const prefix = payload.documentType === 'CREDIT_NOTE' ? 'avoir' : 'facture'
  const filename = `${prefix}-${payload.documentNumber ?? 'brouillon'}.pdf`

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
