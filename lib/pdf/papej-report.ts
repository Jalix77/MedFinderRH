import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib'
import { formatMoney } from '@/lib/format/money'

export type PapejReportExpense = {
  expense_number: string
  payee_name: string
  amount: number
  status: string
  justified: boolean
}

export type PapejReportLine = {
  category: string
  planned_amount: number
  committed_open: number
  available_amount: number
  expenses: PapejReportExpense[]
}

export type PapejReportData = {
  grant_id: string
  grant_name: string
  organization_id: string
  organization_name: string | null
  amount_granted: number
  amount_received: number
  currency: string
  period_start: string
  period_end: string
  lines: PapejReportLine[]
}

const STATUS_LABELS: Record<string, string> = {
  committed: 'Engagee',
  paid: 'Payee',
  justified: 'Justifiee',
  posted: 'Comptabilisee',
}

const MARGIN = 50
const PAGE_WIDTH = 595.28 // A4 portrait, points
const PAGE_HEIGHT = 841.89
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2

// pdf-lib encode les polices StandardFonts en WinAnsi (Latin-1 / code page
// 1252) : page.drawText() leve une exception sur tout caractere hors de
// cette table (code point > 0xFF, a de rares exceptions pres). En trouvaille
// directe (reproduite localement) : Intl.NumberFormat('fr-FR', { style:
// 'currency', ... }) — voir lib/format/money.ts, formatage ecran inchange —
// insere une ESPACE FINE INSECABLE (U+202F) comme separateur de milliers,
// absente de WinAnsi, ce qui faisait planter (500) toute generation PDF des
// qu'un montant depassait 999 (ex. "1 234,00 HTG"). D'autres formatages
// Intl (dates, listes) peuvent produire des variantes similaires selon le
// runtime ICU. `winAnsiSafe` neutralise uniquement ces variantes d'espace
// non imprimables/non representables avant tout drawText — jamais la
// logique de formatage ni les donnees elles-memes.
const NON_WINANSI_SPACES = /[   -   　﻿]/g

function winAnsiSafe(value: string): string {
  const withNormalSpaces = value.replace(NON_WINANSI_SPACES, ' ')
  // Defense en profondeur : tout code point restant hors de portee WinAnsi
  // (deja rencontre une fois avec un marqueur de test utilisant des
  // crochets Unicode ⟦⟧ — corrige a la source, mais ce generateur ne doit
  // de toute facon jamais planter sur une entree qu'il ne controle pas,
  // ex. guillemets typographiques/tiret cadratin/emoji saisis par un
  // utilisateur reel) est remplace par un caractere neutre plutot que de
  // faire planter la generation du PDF.
  return withNormalSpaces.replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')
}

/**
 * Genere le PDF du rapport PAPEJ a partir EXACTEMENT des memes donnees que
 * l'ecran (§ exigence : "l'export doit respecter exactement les filtres et
 * donnees affiches") — cette fonction ne fait que mettre en page la reponse
 * de generate_papej_report(), jamais une nouvelle requete/un nouveau calcul
 * independant de ce que le backend a deja autorise et renvoye.
 */
export async function buildPapejReportPdf(report: PapejReportData, generatedAt: Date): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  let y = PAGE_HEIGHT - MARGIN

  function newPageIfNeeded(minSpace: number) {
    if (y < MARGIN + minSpace) {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
      y = PAGE_HEIGHT - MARGIN
    }
  }

  function text(
    value: string,
    options: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb>; x?: number; gap?: number } = {}
  ) {
    const size = options.size ?? 10
    const f = options.f ?? font
    newPageIfNeeded(size + (options.gap ?? 4))
    page.drawText(winAnsiSafe(value), { x: options.x ?? MARGIN, y, size, font: f, color: options.color ?? rgb(0.1, 0.1, 0.15) })
    y -= size + (options.gap ?? 4)
  }

  function heading(value: string) {
    newPageIfNeeded(28)
    y -= 6
    text(value, { size: 13, f: bold, gap: 8 })
  }

  function hr() {
    newPageIfNeeded(10)
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: MARGIN + CONTENT_WIDTH, y },
      thickness: 0.5,
      color: rgb(0.75, 0.75, 0.78),
    })
    y -= 10
  }

  /** Ligne "libelle : valeur" alignee sur deux colonnes fixes. */
  function fieldRow(label: string, value: string) {
    newPageIfNeeded(16)
    page.drawText(winAnsiSafe(label), { x: MARGIN, y, size: 10, font: bold, color: rgb(0.35, 0.35, 0.4) })
    page.drawText(winAnsiSafe(value), { x: MARGIN + 170, y, size: 10, font, color: rgb(0.1, 0.1, 0.15) })
    y -= 16
  }

  // --- En-tete -------------------------------------------------------
  text('MedFinder Gestion — Rapport PAPEJ', { size: 16, f: bold, gap: 4 })
  text(`Genere le ${formatDateTimeFr(generatedAt)}`, { size: 9, color: rgb(0.45, 0.45, 0.5), gap: 14 })

  fieldRow('Organisation', report.organization_name ?? '—')
  fieldRow('Financement PAPEJ', report.grant_name)
  fieldRow('Periode du rapport', `${report.period_start} au ${report.period_end}`)
  y -= 8
  hr()

  // --- Synthese financiere --------------------------------------------
  const totalCommitted = report.lines.reduce((s, l) => s + Number(l.committed_open), 0)
  const totalAvailable = report.lines.reduce((s, l) => s + Number(l.available_amount), 0)
  const totalPaid = report.lines.reduce(
    (s, l) => s + (Number(l.planned_amount) - Number(l.available_amount) - Number(l.committed_open)),
    0
  )

  heading('Synthese financiere')
  fieldRow('Montant accorde', formatMoney(report.amount_granted, report.currency))
  fieldRow('Montant recu', formatMoney(report.amount_received, report.currency))
  fieldRow('Engage', formatMoney(totalCommitted, report.currency))
  fieldRow('Paye', formatMoney(totalPaid, report.currency))
  fieldRow('Disponible', formatMoney(totalAvailable, report.currency))
  y -= 8
  hr()

  // --- Utilisation par ligne budgetaire --------------------------------
  heading('Utilisation par ligne budgetaire')
  if (report.lines.length === 0) {
    text('Aucune ligne budgetaire rattachee a ce financement pour cette periode.', {
      color: rgb(0.5, 0.5, 0.55),
      gap: 10,
    })
  }
  for (const line of report.lines) {
    newPageIfNeeded(70)
    text(line.category, { size: 11, f: bold, gap: 6 })
    const linePaid = Number(line.planned_amount) - Number(line.available_amount) - Number(line.committed_open)
    text(
      `Prevu ${formatMoney(line.planned_amount, report.currency)}   ·   Engage ${formatMoney(
        line.committed_open,
        report.currency
      )}   ·   Paye ${formatMoney(linePaid, report.currency)}   ·   Disponible ${formatMoney(
        line.available_amount,
        report.currency
      )}`,
      { size: 9, color: rgb(0.35, 0.35, 0.4), gap: 8 }
    )

    if (line.expenses.length === 0) {
      text('Aucune depense rattachee.', { size: 9, color: rgb(0.55, 0.55, 0.6), gap: 10 })
    } else {
      for (const exp of line.expenses) {
        newPageIfNeeded(14)
        const justifLabel = exp.justified ? 'justifie' : 'JUSTIFICATIF MANQUANT'
        text(
          `  ${exp.expense_number}  —  ${exp.payee_name}  —  ${formatMoney(exp.amount, report.currency)}  —  ${
            STATUS_LABELS[exp.status] ?? exp.status
          }  —  ${justifLabel}`,
          { size: 9, gap: 4, color: exp.justified ? rgb(0.1, 0.1, 0.15) : rgb(0.7, 0.15, 0.1) }
        )
      }
    }
    y -= 6
  }
  hr()

  // --- Anomalies / elements en attente ---------------------------------
  heading('Anomalies et elements en attente')
  const unjustified = report.lines.flatMap((l) =>
    l.expenses.filter((e) => !e.justified).map((e) => ({ ...e, category: l.category }))
  )
  const openLines = report.lines.filter((l) => Number(l.committed_open) > 0)

  if (unjustified.length === 0 && openLines.length === 0) {
    text('Aucune anomalie detectee : tous les justificatifs sont deposes, aucun engagement ouvert.', {
      color: rgb(0.15, 0.5, 0.3),
      gap: 10,
    })
  } else {
    if (unjustified.length > 0) {
      text(`Depenses sans justificatif (${unjustified.length}) :`, { f: bold, gap: 6 })
      for (const e of unjustified) {
        newPageIfNeeded(14)
        text(`  ${e.expense_number} — ${e.payee_name} — ${formatMoney(e.amount, report.currency)} (${e.category})`, {
          size: 9,
          color: rgb(0.7, 0.15, 0.1),
          gap: 4,
        })
      }
      y -= 4
    }
    if (openLines.length > 0) {
      text(`Lignes avec engagement encore ouvert (${openLines.length}) :`, { f: bold, gap: 6 })
      for (const l of openLines) {
        newPageIfNeeded(14)
        text(`  ${l.category} — ${formatMoney(l.committed_open, report.currency)} engage, non encore paye`, {
          size: 9,
          color: rgb(0.6, 0.45, 0.05),
          gap: 4,
        })
      }
    }
  }

  return doc.save()
}

function formatDateTimeFr(date: Date): string {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'America/Port-au-Prince',
  }).format(date)
}
