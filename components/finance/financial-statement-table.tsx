'use client'

/**
 * Rendu ecran d'un etat financier (Phase 2B) — recoit EXACTEMENT la meme
 * forme de donnees (colonnes/lignes/synthese) que celle utilisee pour
 * generer le CSV (ici, construit cote client a partir des memes donnees
 * deja autorisees — meme patron que components/finance/papej-report.tsx)
 * et le PDF (lib/pdf/financial-statements-report.ts, memes transformateurs
 * cote serveur) — aucune divergence possible entre les trois
 * representations (§11 du plan Phase 2B).
 */
type Column = { key: string; label: string; align?: 'left' | 'right' }

export function FinancialStatementTable({
  columns,
  rows,
  summaryLines,
  csvFilename,
  pdfHref,
}: {
  columns: Column[]
  rows: Record<string, string>[]
  summaryLines?: { label: string; value: string }[]
  csvFilename: string
  pdfHref: string
}) {
  function downloadCsv() {
    const header = columns.map((c) => c.label)
    const body = rows.map((r) => columns.map((c) => r[c.key] ?? ''))
    const summary = (summaryLines ?? []).map((s) => [s.label, s.value])
    const allRows = [header, ...body, [], ...summary]
    const csv = allRows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = csvFilename
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={downloadCsv}
          className="rounded-lg border border-mf-border px-3 py-1.5 text-xs font-semibold text-mf-navy-700 hover:bg-slate-50"
        >
          Exporter en CSV
        </button>
        <a
          href={pdfHref}
          className="rounded-lg border border-mf-border px-3 py-1.5 text-xs font-semibold text-mf-navy-700 hover:bg-slate-50"
        >
          Exporter en PDF
        </a>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-mf-border bg-mf-surface shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-slate-400">
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={`px-3 py-2 ${c.align === 'right' ? 'text-right' : ''}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-mf-border">
                {columns.map((c) => (
                  <td key={c.key} className={`px-3 py-1.5 ${c.align === 'right' ? 'text-right' : ''}`}>
                    {row[c.key] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-4 text-center text-slate-400">
                  Aucune donnee pour les filtres selectionnes.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {summaryLines && summaryLines.length > 0 && (
        <div className="rounded-2xl border border-mf-border bg-mf-surface p-4 text-sm shadow-sm">
          {summaryLines.map((s) => (
            <div key={s.label} className="flex justify-between py-1">
              <span className="font-medium text-mf-navy-900">{s.label}</span>
              <span>{s.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
