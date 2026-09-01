'use client'

import { useState, useTransition } from 'react'
import { unstable_rethrow } from 'next/navigation'
import { formatMoney } from '@/lib/format/money'

type TreasuryOption = { value: string; label: string; currency: string }

type ParsedLine = {
  value_date: string
  label: string
  external_reference: string | null
  direction: 'in' | 'out'
  amount: number
}

/**
 * Import d'un releve (Phase 2D).
 *
 * Le fichier CSV est NORMALISE cote client — jamais envoye brut : seules
 * des lignes structurees et validees en forme partent au serveur, qui
 * revalide tout (compte, devise deduite du compte, doublon d'import,
 * organisation). Aucune regle de rapprochement n'est appliquee ici.
 *
 * Format attendu, colonnes separees par `,` ou `;` :
 *   date, libelle, reference, debit, credit
 * ou
 *   date, libelle, reference, montant   (negatif = sortie)
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function splitCsvLine(line: string): string[] {
  const sep = line.includes(';') && !line.includes(',') ? ';' : line.split(';').length > line.split(',').length ? ';' : ','
  const out: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i += 1 } else { inQuotes = !inQuotes }
    } else if (c === sep && !inQuotes) {
      out.push(current); current = ''
    } else {
      current += c
    }
  }
  out.push(current)
  return out.map((v) => v.trim().replace(/^"|"$/g, ''))
}

function toNumber(raw: string): number {
  if (!raw) return 0
  // Tolere « 1 234,56 », « 1,234.56 » et les espaces insecables.
  const cleaned = raw.replace(/[\s  ]/g, '')
  const normalized = cleaned.includes(',') && cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned.replace(/,/g, '')
  const n = Number(normalized)
  return Number.isFinite(n) ? n : 0
}

function parseCsv(text: string): { lines: ParsedLine[]; errors: string[] } {
  const rows = text.split(/\r?\n/).map((r) => r.trim()).filter((r) => r.length > 0)
  const lines: ParsedLine[] = []
  const errors: string[] = []

  for (let i = 0; i < rows.length; i += 1) {
    const cells = splitCsvLine(rows[i])
    const first = cells[0] ?? ''
    // En-tete ignore : premiere cellule non reconnue comme date.
    if (i === 0 && !DATE_RE.test(first)) continue
    if (!DATE_RE.test(first)) {
      errors.push(`Ligne ${i + 1} : date « ${first} » non reconnue (format attendu AAAA-MM-JJ).`)
      continue
    }

    const label = cells[1] ?? ''
    const reference = (cells[2] ?? '').trim() || null

    let direction: 'in' | 'out'
    let amount: number

    if (cells.length >= 5) {
      const debit = toNumber(cells[3] ?? '')
      const credit = toNumber(cells[4] ?? '')
      if (debit > 0 && credit > 0) {
        errors.push(`Ligne ${i + 1} : debit et credit renseignes simultanement.`)
        continue
      }
      if (debit > 0) { direction = 'out'; amount = debit }
      else if (credit > 0) { direction = 'in'; amount = credit }
      else { errors.push(`Ligne ${i + 1} : montant nul.`); continue }
    } else {
      const signed = toNumber(cells[3] ?? '')
      if (signed === 0) { errors.push(`Ligne ${i + 1} : montant nul ou illisible.`); continue }
      direction = signed < 0 ? 'out' : 'in'
      amount = Math.abs(signed)
    }

    lines.push({
      value_date: first,
      label: label || '(sans libelle)',
      external_reference: reference,
      direction,
      amount: Math.round(amount * 100) / 100,
    })
  }

  return { lines, errors }
}

export function StatementImportForm({
  action,
  treasuryAccounts,
}: {
  action: (formData: FormData) => Promise<void>
  treasuryAccounts: TreasuryOption[]
}) {
  const [lines, setLines] = useState<ParsedLine[]>([])
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [fileName, setFileName] = useState('')
  const [account, setAccount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const currency = treasuryAccounts.find((a) => a.value === account)?.currency ?? 'HTG'
  const totalIn = lines.filter((l) => l.direction === 'in').reduce((s, l) => s + l.amount, 0)
  const totalOut = lines.filter((l) => l.direction === 'out').reduce((s, l) => s + l.amount, 0)

  async function handleFile(file: File) {
    setError(null)
    const text = await file.text()
    const { lines: parsed, errors } = parseCsv(text)
    setLines(parsed)
    setParseErrors(errors)
    setFileName(file.name)
  }

  function handleSubmit(formData: FormData) {
    setError(null)
    if (lines.length === 0) {
      setError('Aucune ligne exploitable dans le fichier.')
      return
    }
    formData.set('lines', JSON.stringify(lines))
    formData.set('file_name', fileName)
    startTransition(async () => {
      try {
        await action(formData)
      } catch (err) {
        unstable_rethrow(err)
        setError(err instanceof Error ? err.message : 'Import impossible.')
      }
    })
  }

  return (
    <form action={handleSubmit} className="space-y-5">
      <section className="grid gap-4 rounded-2xl border border-mf-border bg-mf-surface p-4 shadow-sm sm:grid-cols-2">
        <div>
          <label htmlFor="treasury_account" className="block text-xs font-medium text-mf-navy-900">
            Compte de tresorerie
          </label>
          <select id="treasury_account" name="treasury_account" required value={account}
            onChange={(e) => setAccount(e.target.value)}
            className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm">
            <option value="">— Choisir —</option>
            {treasuryAccounts.map((a) => (
              <option key={a.value} value={a.value}>{a.label} ({a.currency})</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-400">
            La devise du releve est deduite du compte — aucun rapprochement en devise croisee.
          </p>
        </div>

        <div>
          <label htmlFor="statement_reference" className="block text-xs font-medium text-mf-navy-900">
            Reference du releve
          </label>
          <input id="statement_reference" name="statement_reference" required
            placeholder="Releve mars 2026"
            className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
        </div>

        <div>
          <label htmlFor="period_start" className="block text-xs font-medium text-mf-navy-900">Periode du</label>
          <input id="period_start" name="period_start" type="date" required
            className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
        </div>
        <div>
          <label htmlFor="period_end" className="block text-xs font-medium text-mf-navy-900">au</label>
          <input id="period_end" name="period_end" type="date" required
            className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
        </div>

        <div>
          <label htmlFor="opening_balance" className="block text-xs font-medium text-mf-navy-900">
            Solde d&apos;ouverture du releve
          </label>
          <input id="opening_balance" name="opening_balance" type="number" step="0.01" defaultValue="0"
            className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
        </div>
        <div>
          <label htmlFor="closing_balance" className="block text-xs font-medium text-mf-navy-900">
            Solde de cloture du releve
          </label>
          <input id="closing_balance" name="closing_balance" type="number" step="0.01" defaultValue="0"
            className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-mf-border bg-mf-surface p-4 shadow-sm">
        <label htmlFor="csv_file" className="block text-sm font-semibold text-mf-navy-900">
          Fichier du releve (CSV)
        </label>
        <input id="csv_file" type="file" accept=".csv,text/csv"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f) }}
          className="block w-full text-sm" />
        <p className="text-xs text-slate-400">
          Colonnes attendues : date (AAAA-MM-JJ), libelle, reference, debit, credit — ou date, libelle,
          reference, montant signe. Separateur <code>,</code> ou <code>;</code>. Une eventuelle ligne
          d&apos;en-tete est ignoree.
        </p>

        {parseErrors.length > 0 && (
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <p className="font-semibold">{parseErrors.length} ligne(s) ignoree(s) :</p>
            <ul className="mt-1 list-disc pl-4">
              {parseErrors.slice(0, 5).map((e, i) => (<li key={i}>{e}</li>))}
              {parseErrors.length > 5 && <li>… et {parseErrors.length - 5} autre(s).</li>}
            </ul>
          </div>
        )}

        {lines.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm text-mf-navy-900">
              <strong>{lines.length}</strong> ligne(s) exploitable(s) — entrees{' '}
              <strong>{formatMoney(totalIn, currency)}</strong>, sorties{' '}
              <strong>{formatMoney(totalOut, currency)}</strong>
            </p>
            <div className="max-h-64 overflow-y-auto rounded-lg border border-mf-border">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-50 text-slate-400">
                  <tr>
                    <th className="px-2 py-1">Date</th>
                    <th className="px-2 py-1">Libelle</th>
                    <th className="px-2 py-1">Reference</th>
                    <th className="px-2 py-1">Sens</th>
                    <th className="px-2 py-1 text-right">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i} className="border-t border-mf-border">
                      <td className="px-2 py-1">{l.value_date}</td>
                      <td className="px-2 py-1">{l.label}</td>
                      <td className="px-2 py-1">{l.external_reference ?? '—'}</td>
                      <td className="px-2 py-1">{l.direction === 'in' ? 'Entree' : 'Sortie'}</td>
                      <td className="px-2 py-1 text-right">{formatMoney(l.amount, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-mf-danger">{error}</p>}

      <button type="submit" disabled={pending || lines.length === 0}
        className="rounded-lg bg-mf-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-navy-800 disabled:opacity-60">
        {pending ? 'Import en cours…' : `Importer ${lines.length} ligne(s)`}
      </button>
    </form>
  )
}
