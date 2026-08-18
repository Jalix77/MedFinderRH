import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib'
import { formatMoney } from '@/lib/format/money'

/**
 * Renderer PDF generique pour les 6 etats financiers (Phase 2B,
 * docs/phase-2b-plan.md §11) — un seul moteur de mise en page tabulaire,
 * chaque etat ne fait que transformer la reponse JSON de SA propre RPC
 * (deja verifiee/autorisee, jamais un second calcul) en lignes de tableau.
 * Meme discipline WinAnsi que lib/pdf/papej-report.ts (§19 du rapport de
 * cloture Phase 1C) — reprise a l'identique, pas reinventee.
 */

const MARGIN = 50
const PAGE_WIDTH = 841.89 // A4 paysage — les etats financiers ont plus de colonnes que PAPEJ
const PAGE_HEIGHT = 595.28
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2

const NON_WINANSI_SPACES = /[   -   　﻿]/g

function winAnsiSafe(value: string): string {
  const withNormalSpaces = String(value ?? '').replace(NON_WINANSI_SPACES, ' ')
  return withNormalSpaces.replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')
}

export type PdfTableColumn = { key: string; label: string; align?: 'left' | 'right'; width?: number }
export type PdfTableReport = {
  title: string
  subtitle: string
  columns: PdfTableColumn[]
  rows: Record<string, string>[]
  summaryLines?: { label: string; value: string }[]
}

export async function buildTabularReportPdf(report: PdfTableReport, generatedAt: Date): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  let y = PAGE_HEIGHT - MARGIN

  function newPageIfNeeded(minSpace: number) {
    if (y < MARGIN + minSpace) {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
      y = PAGE_HEIGHT - MARGIN
      drawHeaderRow()
    }
  }

  function text(value: string, options: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb>; x?: number; gap?: number } = {}) {
    const size = options.size ?? 10
    const f = options.f ?? font
    page.drawText(winAnsiSafe(value), { x: options.x ?? MARGIN, y, size, font: f, color: options.color ?? rgb(0.1, 0.1, 0.15) })
    y -= size + (options.gap ?? 4)
  }

  const colWidths = computeColumnWidths(report.columns, CONTENT_WIDTH)

  function drawHeaderRow() {
    let x = MARGIN
    for (let i = 0; i < report.columns.length; i++) {
      const col = report.columns[i]
      page.drawText(winAnsiSafe(col.label), { x, y, size: 8, font: bold, color: rgb(0.35, 0.35, 0.4) })
      x += colWidths[i]
    }
    y -= 12
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + CONTENT_WIDTH, y }, thickness: 0.5, color: rgb(0.75, 0.75, 0.78) })
    y -= 8
  }

  // --- En-tete ---------------------------------------------------------
  text(report.title, { size: 15, f: bold, gap: 4 })
  text(report.subtitle, { size: 9, color: rgb(0.45, 0.45, 0.5), gap: 4 })
  text(`Genere le ${formatDateTimeFr(generatedAt)}`, { size: 8, color: rgb(0.55, 0.55, 0.6), gap: 12 })

  // --- Tableau -----------------------------------------------------------
  drawHeaderRow()
  for (const row of report.rows) {
    newPageIfNeeded(14)
    let x = MARGIN
    for (let i = 0; i < report.columns.length; i++) {
      const col = report.columns[i]
      const raw = row[col.key] ?? ''
      const textX = col.align === 'right' ? x + colWidths[i] - 6 - estimateTextWidth(raw, 8) : x
      page.drawText(winAnsiSafe(raw), { x: textX, y, size: 8, font, color: rgb(0.1, 0.1, 0.15) })
      x += colWidths[i]
    }
    y -= 12
  }
  if (report.rows.length === 0) {
    text('Aucune donnee pour les filtres selectionnes.', { size: 9, color: rgb(0.5, 0.5, 0.55), gap: 8 })
  }

  // --- Synthese / controles de reconciliation -----------------------------
  if (report.summaryLines && report.summaryLines.length > 0) {
    newPageIfNeeded(20 + report.summaryLines.length * 14)
    y -= 10
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + CONTENT_WIDTH, y }, thickness: 0.5, color: rgb(0.75, 0.75, 0.78) })
    y -= 16
    for (const line of report.summaryLines) {
      newPageIfNeeded(16)
      page.drawText(winAnsiSafe(line.label), { x: MARGIN, y, size: 10, font: bold, color: rgb(0.35, 0.35, 0.4) })
      page.drawText(winAnsiSafe(line.value), { x: MARGIN + 260, y, size: 10, font, color: rgb(0.1, 0.1, 0.15) })
      y -= 16
    }
  }

  return doc.save()
}

function computeColumnWidths(columns: PdfTableColumn[], totalWidth: number): number[] {
  const withWidth = columns.filter((c) => c.width)
  const fixedTotal = withWidth.reduce((s, c) => s + (c.width ?? 0), 0)
  const remaining = totalWidth - fixedTotal
  const flexCount = columns.length - withWidth.length
  const flexWidth = flexCount > 0 ? remaining / flexCount : 0
  return columns.map((c) => c.width ?? flexWidth)
}

// Approximation grossiere (Helvetica ~0.5em par caractere a taille size) —
// suffisante pour un alignement a droite visuellement correct, jamais
// utilisee pour une decision metier.
function estimateTextWidth(value: string, size: number): number {
  return String(value ?? '').length * size * 0.5
}

function formatDateTimeFr(date: Date): string {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Port-au-Prince' }).format(date)
}

// --- Transformateurs : reponse RPC (deja autorisee) -> table PDF generique

export function journalGeneralToTable(orgName: string, r: {
  period_start: string; period_end: string; journal_code: string | null
  lines: { entry_number: string; entry_date: string; journal_code: string; reference: string; libelle: string; account_code: string; account_label: string; debit: number; credit: number; source_type: string; cost_center_code: string }[]
  total_debit: number; total_credit: number
}): PdfTableReport {
  return {
    title: 'Journal general',
    subtitle: `${orgName} — ${r.period_start} au ${r.period_end}${r.journal_code ? ` — Journal ${r.journal_code}` : ''}`,
    columns: [
      { key: 'entry_number', label: 'N. ecriture', width: 90 },
      { key: 'entry_date', label: 'Date', width: 65 },
      { key: 'journal_code', label: 'Journal', width: 45 },
      { key: 'account', label: 'Compte', width: 160 },
      { key: 'libelle', label: 'Libelle', width: 200 },
      { key: 'source_type', label: 'Source', width: 60 },
      { key: 'cost_center_code', label: 'Centre cout', width: 65 },
      { key: 'debit', label: 'Debit', align: 'right', width: 60 },
      { key: 'credit', label: 'Credit', align: 'right' },
    ],
    rows: r.lines.map((l) => ({
      entry_number: l.entry_number,
      entry_date: l.entry_date,
      journal_code: l.journal_code,
      account: `${l.account_code} ${l.account_label}`,
      libelle: l.libelle ?? '',
      source_type: l.source_type,
      cost_center_code: l.cost_center_code,
      debit: Number(l.debit) > 0 ? formatMoney(l.debit) : '',
      credit: Number(l.credit) > 0 ? formatMoney(l.credit) : '',
    })),
    summaryLines: [
      { label: 'Total debit', value: formatMoney(r.total_debit) },
      { label: 'Total credit', value: formatMoney(r.total_credit) },
    ],
  }
}

export function generalLedgerToTable(orgName: string, r: {
  period_start: string; period_end: string
  accounts: { code: string; label: string; opening_balance: number; total_debit: number; total_credit: number; closing_balance: number }[]
}): PdfTableReport {
  return {
    title: 'Grand livre',
    subtitle: `${orgName} — ${r.period_start} au ${r.period_end}`,
    columns: [
      { key: 'code', label: 'Compte', width: 80 },
      { key: 'label', label: 'Libelle', width: 220 },
      { key: 'opening', label: 'Solde ouverture', align: 'right', width: 110 },
      { key: 'debit', label: 'Debit periode', align: 'right', width: 100 },
      { key: 'credit', label: 'Credit periode', align: 'right', width: 100 },
      { key: 'closing', label: 'Solde cloture', align: 'right' },
    ],
    rows: r.accounts.map((a) => ({
      code: a.code,
      label: a.label,
      opening: formatMoney(a.opening_balance),
      debit: formatMoney(a.total_debit),
      credit: formatMoney(a.total_credit),
      closing: formatMoney(a.closing_balance),
    })),
  }
}

export function trialBalanceToTable(orgName: string, r: {
  period_start: string; period_end: string
  accounts: { code: string; label: string; type: string; opening_balance: number; period_debit: number; period_credit: number; closing_balance_normal: number; sens: string }[]
  total_period_debit: number; total_period_credit: number; sum_closing_balance_brut: number
}): PdfTableReport {
  return {
    title: 'Balance generale',
    subtitle: `${orgName} — ${r.period_start} au ${r.period_end}`,
    columns: [
      { key: 'code', label: 'Compte', width: 80 },
      { key: 'label', label: 'Libelle', width: 200 },
      { key: 'opening', label: 'Solde ouverture', align: 'right', width: 100 },
      { key: 'debit', label: 'Debit periode', align: 'right', width: 90 },
      { key: 'credit', label: 'Credit periode', align: 'right', width: 90 },
      { key: 'closing', label: 'Solde cloture', align: 'right', width: 100 },
      { key: 'sens', label: 'Sens', align: 'right' },
    ],
    rows: r.accounts.map((a) => ({
      code: a.code,
      label: a.label,
      opening: formatMoney(a.opening_balance),
      debit: formatMoney(a.period_debit),
      credit: formatMoney(a.period_credit),
      closing: formatMoney(a.closing_balance_normal),
      sens: a.sens,
    })),
    summaryLines: [
      { label: 'Total debit periode', value: formatMoney(r.total_period_debit) },
      { label: 'Total credit periode', value: formatMoney(r.total_period_credit) },
      { label: 'Somme des soldes bruts de cloture (controle)', value: formatMoney(r.sum_closing_balance_brut) },
    ],
  }
}

export function incomeStatementToTable(orgName: string, r: {
  period_start: string; period_end: string
  revenues: { code: string; label: string; amount: number }[]
  expenses: { code: string; label: string; amount: number }[]
  total_revenue: number; total_expense: number; net_result: number
}): PdfTableReport {
  return {
    title: 'Compte de resultat',
    subtitle: `${orgName} — ${r.period_start} au ${r.period_end}`,
    columns: [
      { key: 'category', label: 'Categorie', width: 100 },
      { key: 'code', label: 'Compte', width: 80 },
      { key: 'label', label: 'Libelle', width: 300 },
      { key: 'amount', label: 'Montant', align: 'right' },
    ],
    rows: [
      ...r.revenues.map((a) => ({ category: 'Produit', code: a.code, label: a.label, amount: formatMoney(a.amount) })),
      ...r.expenses.map((a) => ({ category: 'Charge', code: a.code, label: a.label, amount: formatMoney(a.amount) })),
    ],
    summaryLines: [
      { label: 'Total produits', value: formatMoney(r.total_revenue) },
      { label: 'Total charges', value: formatMoney(r.total_expense) },
      { label: 'Resultat net (Produits - Charges)', value: formatMoney(r.net_result) },
    ],
  }
}

export function balanceSheetToTable(orgName: string, r: {
  as_of_date: string
  assets: { code: string; label: string; balance: number }[]
  liabilities: { code: string; label: string; balance: number }[]
  equity: { code: string; label: string; balance: number }[]
  unaffected_result: number; total_assets: number; total_liabilities_and_equity: number
}): PdfTableReport {
  return {
    title: 'Bilan',
    subtitle: `${orgName} — au ${r.as_of_date}`,
    columns: [
      { key: 'category', label: 'Categorie', width: 130 },
      { key: 'code', label: 'Compte', width: 80 },
      { key: 'label', label: 'Libelle', width: 300 },
      { key: 'amount', label: 'Montant', align: 'right' },
    ],
    rows: [
      ...r.assets.map((a) => ({ category: 'Actif', code: a.code, label: a.label, amount: formatMoney(a.balance) })),
      ...r.liabilities.map((a) => ({ category: 'Passif', code: a.code, label: a.label, amount: formatMoney(a.balance) })),
      ...r.equity.map((a) => ({ category: 'Capitaux propres', code: a.code, label: a.label, amount: formatMoney(a.balance) })),
      { category: 'Capitaux propres', code: '—', label: 'Resultat de l\'exercice non affecte', amount: formatMoney(r.unaffected_result) },
    ],
    summaryLines: [
      { label: 'Total Actif', value: formatMoney(r.total_assets) },
      { label: 'Total Passif + Capitaux Propres + Resultat non affecte', value: formatMoney(r.total_liabilities_and_equity) },
    ],
  }
}

export function cashFlowToTable(orgName: string, r: {
  period_start: string; period_end: string; method: string
  lines: { entry_number: string; entry_date: string; libelle: string; debit: number; credit: number; category: string }[]
  opening_balance: number; closing_balance: number
  operating: number; investing: number; financing: number; unclassified: number; internal_transfers: number
}): PdfTableReport {
  const categoryLabels: Record<string, string> = {
    operating: 'Exploitation', investing: 'Investissement', financing: 'Financement',
    UNCLASSIFIED: 'Non classifie', INTERNAL_TRANSFER: 'Virement interne',
  }
  return {
    title: 'Flux de tresorerie (methode directe)',
    subtitle: `${orgName} — ${r.period_start} au ${r.period_end}`,
    columns: [
      { key: 'entry_number', label: 'N. ecriture', width: 90 },
      { key: 'entry_date', label: 'Date', width: 65 },
      { key: 'libelle', label: 'Libelle', width: 260 },
      { key: 'category', label: 'Categorie', width: 110 },
      { key: 'debit', label: 'Entree', align: 'right', width: 90 },
      { key: 'credit', label: 'Sortie', align: 'right' },
    ],
    rows: r.lines.map((l) => ({
      entry_number: l.entry_number,
      entry_date: l.entry_date,
      libelle: l.libelle ?? '',
      category: categoryLabels[l.category] ?? l.category,
      debit: Number(l.debit) > 0 ? formatMoney(l.debit) : '',
      credit: Number(l.credit) > 0 ? formatMoney(l.credit) : '',
    })),
    summaryLines: [
      { label: 'Tresorerie d\'ouverture', value: formatMoney(r.opening_balance) },
      { label: 'Flux d\'exploitation', value: formatMoney(r.operating) },
      { label: 'Flux d\'investissement', value: formatMoney(r.investing) },
      { label: 'Flux de financement', value: formatMoney(r.financing) },
      { label: 'Flux non classifies', value: formatMoney(r.unclassified) },
      { label: 'Virements internes (net, hors flux)', value: formatMoney(r.internal_transfers) },
      { label: 'Tresorerie de cloture', value: formatMoney(r.closing_balance) },
    ],
  }
}
