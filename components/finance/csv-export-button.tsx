'use client'

/**
 * Export CSV construit cote client a partir des donnees DEJA affichees et
 * DEJA autorisees par la RLS — jamais un second aller-retour serveur qui
 * constituerait une seconde autorite. Meme patron que
 * components/finance/financial-statement-table.tsx (Phase 2B).
 */
export function CsvExportButton({
  rows,
  filename,
  label = 'Exporter en CSV',
}: {
  rows: Record<string, string>[]
  filename: string
  label?: string
}) {
  function download() {
    if (rows.length === 0) return
    const headers = Object.keys(rows[0])
    const body = rows.map((r) => headers.map((h) => r[h] ?? ''))
    const csv = [headers, ...body]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    // BOM UTF-8 : Excel affiche correctement les accents.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <button
      type="button"
      onClick={download}
      disabled={rows.length === 0}
      className="rounded-lg border border-mf-border px-3 py-2 text-sm font-semibold text-mf-navy-700 hover:bg-slate-50 disabled:opacity-40"
    >
      {label}
    </button>
  )
}
