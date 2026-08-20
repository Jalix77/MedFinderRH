import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib'
import { formatMoney } from '@/lib/format/money'

/**
 * PDF de facture / avoir (Phase 2C.4).
 *
 * Meme discipline WinAnsi que lib/pdf/papej-report.ts et
 * lib/pdf/financial-statements-report.ts : pdf-lib n'encode pas les
 * caracteres hors WinAnsi (notamment l'espace fine insecable produite par
 * Intl.NumberFormat), d'ou winAnsiSafe() applique a TOUT texte dessine.
 *
 * Le document est rendu a partir des donnees DEJA lues et autorisees par
 * l'appelant (Route Handler sous la session de l'utilisateur) — jamais
 * d'acces base ici, et jamais un second calcul des montants.
 */

const MARGIN = 50
const PAGE_WIDTH = 595.28 // A4 portrait
const PAGE_HEIGHT = 841.89
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2

const NON_WINANSI_SPACES = /[  -​  　﻿]/g

function winAnsiSafe(value: string): string {
  const withNormalSpaces = String(value ?? '').replace(NON_WINANSI_SPACES, ' ')
  return withNormalSpaces.replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')
}

export type InvoicePdfLine = {
  description: string
  quantity: number
  unit_price: number
  tax_rate_percent: number
  line_subtotal: number
  tax_amount: number
  line_total: number
}

export type InvoicePdfPayment = {
  payment_number: string
  payment_date: string
  amount: number
  status: string
}

export type InvoicePdfData = {
  organizationName: string
  documentType: 'INVOICE' | 'CREDIT_NOTE'
  documentNumber: string | null
  status: string
  documentDate: string
  dueDate: string
  currency: string
  exchangeRateToHtg: number
  externalReference: string | null
  notes: string | null
  creditReason: string | null
  creditedDocumentNumber: string | null
  thirdPartyName: string
  thirdPartyTaxId: string | null
  lines: InvoicePdfLine[]
  subtotal: number
  taxTotal: number
  total: number
  totalHtg: number
  amountPaid: number
  balanceDue: number
  payments: InvoicePdfPayment[]
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon',
  pending_issue: 'A emettre',
  issued: 'Emise',
  partially_paid: 'Partiellement payee',
  paid: 'Payee',
  cancelled: 'Annulee',
}

export async function buildInvoicePdf(data: InvoicePdfData, generatedAt: Date): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  let y = PAGE_HEIGHT - MARGIN

  function text(
    value: string,
    o: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb>; x?: number; gap?: number } = {}
  ) {
    const size = o.size ?? 10
    page.drawText(winAnsiSafe(value), {
      x: o.x ?? MARGIN,
      y,
      size,
      font: o.f ?? font,
      color: o.color ?? rgb(0.1, 0.1, 0.15),
    })
    y -= size + (o.gap ?? 4)
  }

  function newPageIfNeeded(minSpace: number) {
    if (y < MARGIN + minSpace) {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
      y = PAGE_HEIGHT - MARGIN
    }
  }

  function money(v: number) {
    return formatMoney(v, data.currency)
  }

  const isCredit = data.documentType === 'CREDIT_NOTE'
  const title = isCredit ? 'AVOIR' : 'FACTURE'

  // --- En-tete -----------------------------------------------------------
  text(data.organizationName, { size: 14, f: bold, gap: 2 })
  text(`${title} ${data.documentNumber ?? '(brouillon — non emis)'}`, {
    size: 18,
    f: bold,
    gap: 6,
  })
  text(`Statut : ${STATUS_LABELS[data.status] ?? data.status}`, {
    size: 9,
    color: rgb(0.45, 0.45, 0.5),
    gap: 10,
  })

  // --- Parties -----------------------------------------------------------
  text('Client', { size: 8, f: bold, color: rgb(0.45, 0.45, 0.5), gap: 3 })
  text(data.thirdPartyName, { size: 11, f: bold, gap: 3 })
  if (data.thirdPartyTaxId) text(`NIF / identifiant fiscal : ${data.thirdPartyTaxId}`, { size: 9, gap: 3 })
  y -= 6

  text(`Date du document : ${data.documentDate}`, { size: 9, gap: 3 })
  text(`Echeance : ${data.dueDate}`, { size: 9, gap: 3 })
  text(`Devise : ${data.currency}`, { size: 9, gap: 3 })
  if (data.currency !== 'HTG') {
    text(`Taux applique (fige a l'emission) : ${data.exchangeRateToHtg}`, { size: 9, gap: 3 })
  }
  if (data.externalReference) text(`Reference externe : ${data.externalReference}`, { size: 9, gap: 3 })
  if (isCredit && data.creditedDocumentNumber) {
    text(`Avoir sur la facture : ${data.creditedDocumentNumber}`, { size: 9, f: bold, gap: 3 })
  }
  if (isCredit && data.creditReason) text(`Motif : ${data.creditReason}`, { size: 9, gap: 3 })
  y -= 10

  // --- Lignes ------------------------------------------------------------
  const cols = [
    { label: 'Description', x: MARGIN, width: 210 },
    { label: 'Qte', x: MARGIN + 215, width: 45 },
    { label: 'P.U.', x: MARGIN + 262, width: 75 },
    { label: 'Taxe', x: MARGIN + 340, width: 45 },
    { label: 'Total', x: MARGIN + 388, width: 107 },
  ]

  function drawHeaderRow() {
    for (const c of cols) {
      page.drawText(winAnsiSafe(c.label), { x: c.x, y, size: 8, font: bold, color: rgb(0.35, 0.35, 0.4) })
    }
    y -= 12
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: MARGIN + CONTENT_WIDTH, y },
      thickness: 0.5,
      color: rgb(0.75, 0.75, 0.78),
    })
    y -= 10
  }
  drawHeaderRow()

  for (const l of data.lines) {
    newPageIfNeeded(30)
    const desc = winAnsiSafe(l.description)
    page.drawText(desc.slice(0, 44), { x: cols[0].x, y, size: 8, font })
    page.drawText(winAnsiSafe(String(l.quantity)), { x: cols[1].x, y, size: 8, font })
    page.drawText(winAnsiSafe(money(l.unit_price)), { x: cols[2].x, y, size: 8, font })
    page.drawText(winAnsiSafe(l.tax_rate_percent > 0 ? `${l.tax_rate_percent}%` : '—'), {
      x: cols[3].x,
      y,
      size: 8,
      font,
    })
    page.drawText(winAnsiSafe(money(l.line_total)), { x: cols[4].x, y, size: 8, font })
    y -= 13
  }

  // --- Totaux ------------------------------------------------------------
  newPageIfNeeded(120)
  y -= 6
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: MARGIN + CONTENT_WIDTH, y },
    thickness: 0.5,
    color: rgb(0.75, 0.75, 0.78),
  })
  y -= 16

  function totalRow(label: string, value: string, strong = false) {
    page.drawText(winAnsiSafe(label), {
      x: MARGIN + 260,
      y,
      size: strong ? 11 : 9,
      font: strong ? bold : font,
      color: strong ? rgb(0.1, 0.1, 0.15) : rgb(0.35, 0.35, 0.4),
    })
    page.drawText(winAnsiSafe(value), {
      x: MARGIN + 400,
      y,
      size: strong ? 11 : 9,
      font: strong ? bold : font,
    })
    y -= strong ? 18 : 14
  }

  totalRow('Sous-total', money(data.subtotal))
  totalRow('Taxes', money(data.taxTotal))
  totalRow('Total', money(data.total), true)
  if (data.currency !== 'HTG') {
    totalRow('Contre-valeur HTG (historique)', formatMoney(data.totalHtg, 'HTG'))
  }
  totalRow('Deja paye', money(data.amountPaid))
  totalRow('Reste a payer', money(data.balanceDue), true)

  // --- Encaissements -----------------------------------------------------
  const recorded = data.payments.filter((p) => p.status === 'recorded')
  if (recorded.length > 0) {
    newPageIfNeeded(40 + recorded.length * 13)
    y -= 8
    text('Encaissements', { size: 10, f: bold, gap: 6 })
    for (const p of recorded) {
      newPageIfNeeded(20)
      page.drawText(winAnsiSafe(`${p.payment_date}  ${p.payment_number}`), { x: MARGIN, y, size: 8, font })
      page.drawText(winAnsiSafe(money(p.amount)), { x: MARGIN + 300, y, size: 8, font })
      y -= 13
    }
  }

  // --- Pied ---------------------------------------------------------------
  if (data.notes) {
    newPageIfNeeded(40)
    y -= 8
    text('Notes', { size: 9, f: bold, gap: 4 })
    text(data.notes.slice(0, 400), { size: 8, color: rgb(0.35, 0.35, 0.4), gap: 4 })
  }

  newPageIfNeeded(24)
  y -= 6
  text(`Genere le ${formatDateTimeFr(generatedAt)}`, { size: 7, color: rgb(0.55, 0.55, 0.6), gap: 2 })

  return doc.save()
}

function formatDateTimeFr(date: Date): string {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'America/Port-au-Prince',
  }).format(date)
}
