'use client'

import { useState, useTransition } from 'react'
import { generatePapejReportAction } from '@/app/actions/papej'
import { formatMoney } from '@/lib/format/money'

type ReportLine = {
  category: string
  planned_amount: number
  committed_open: number
  available_amount: number
  expenses: { expense_number: string; payee_name: string; amount: number; status: string; justified: boolean }[]
}
type Report = {
  grant_id: string
  grant_name: string
  amount_granted: number
  amount_received: number
  currency: string
  period_start: string
  period_end: string
  lines: ReportLine[]
}

/**
 * Genere le rapport PAPEJ (RPC generate_papej_report — donnees jsonb,
 * aucun rendu PDF cote backend) et propose un export CSV construit cote
 * client a partir de ces memes donnees deja autorisees par le backend —
 * pas une capacite nouvelle, juste une mise en forme telechargeable de ce
 * que le RPC a deja renvoye (§ perimetre UI : "export lorsque le backend
 * le permet deja").
 */
export function PapejReportGenerator({ grantId }: { grantId: string }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const today = new Date().toISOString().slice(0, 10)
  const yearStart = `${new Date().getFullYear()}-01-01`

  function handleSubmit(formData: FormData) {
    setError(null)
    startTransition(async () => {
      try {
        const result = (await generatePapejReportAction(formData)) as { report: Report }
        setReport(result.report)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Echec de generation du rapport.')
      }
    })
  }

  function downloadCsv() {
    if (!report) return
    const rows = [['Categorie', 'Prevu', 'Engage', 'Disponible', 'Depense', 'Beneficiaire', 'Montant', 'Statut', 'Justifie']]
    for (const line of report.lines) {
      if (line.expenses.length === 0) {
        rows.push([line.category, String(line.planned_amount), String(line.committed_open), String(line.available_amount), '', '', '', '', ''])
      }
      for (const exp of line.expenses) {
        rows.push([
          line.category,
          String(line.planned_amount),
          String(line.committed_open),
          String(line.available_amount),
          exp.expense_number,
          exp.payee_name,
          String(exp.amount),
          exp.status,
          exp.justified ? 'oui' : 'non',
        ])
      }
    }
    const csv = rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `rapport-papej-${report.grant_name}-${report.period_start}-${report.period_end}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <form action={handleSubmit} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="grant_id" value={grantId} />
        <div>
          <label htmlFor="period_start" className="block text-xs font-medium text-mf-navy-900">Periode — du</label>
          <input id="period_start" type="date" name="period_start" defaultValue={yearStart} required className="mt-1 rounded-lg border border-mf-border px-3 py-2 text-sm" />
        </div>
        <div>
          <label htmlFor="period_end" className="block text-xs font-medium text-mf-navy-900">au</label>
          <input id="period_end" type="date" name="period_end" defaultValue={today} required className="mt-1 rounded-lg border border-mf-border px-3 py-2 text-sm" />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-mf-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-navy-800 disabled:opacity-60"
        >
          {pending ? 'Generation...' : 'Generer le rapport'}
        </button>
        {report && (
          <button
            type="button"
            onClick={downloadCsv}
            className="rounded-lg border border-mf-border px-4 py-2 text-sm font-semibold text-mf-navy-700 hover:bg-slate-50"
          >
            Exporter en CSV
          </button>
        )}
      </form>
      {error && <p className="text-sm text-mf-danger">{error}</p>}

      {report && (
        <div className="overflow-x-auto rounded-lg border border-mf-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Categorie</th>
                <th className="px-3 py-2">Prevu</th>
                <th className="px-3 py-2">Engage</th>
                <th className="px-3 py-2">Disponible</th>
                <th className="px-3 py-2">Depenses rattachees</th>
              </tr>
            </thead>
            <tbody>
              {report.lines.map((line) => (
                <tr key={line.category} className="border-t border-mf-border align-top">
                  <td className="px-3 py-2 text-mf-navy-900">{line.category}</td>
                  <td className="px-3 py-2">{formatMoney(line.planned_amount, report.currency)}</td>
                  <td className="px-3 py-2 text-amber-700">{formatMoney(line.committed_open, report.currency)}</td>
                  <td className="px-3 py-2 font-medium text-mf-emerald-700">
                    {formatMoney(line.available_amount, report.currency)}
                  </td>
                  <td className="px-3 py-2">
                    {line.expenses.length === 0 && <span className="text-slate-400">Aucune</span>}
                    <ul className="space-y-1">
                      {line.expenses.map((exp) => (
                        <li key={exp.expense_number}>
                          {exp.expense_number} — {exp.payee_name} — {formatMoney(exp.amount, report.currency)}
                          {!exp.justified && (
                            <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                              Justificatif manquant
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
              {report.lines.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-slate-400">
                    Aucune ligne PAPEJ pour cette periode.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
