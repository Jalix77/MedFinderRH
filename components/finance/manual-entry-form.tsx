'use client'

import { useRef, useState, useTransition } from 'react'
import { unstable_rethrow } from 'next/navigation'
import { createManualJournalEntryAction } from '@/app/actions/accounting'

type Account = { id: string; code: string; label: string }
type Journal = { id: string; code: string; label: string }

type Line = { account_id: string; debit: string; credit: string }

const EMPTY_LINE: Line = { account_id: '', debit: '', credit: '' }

/**
 * Formulaire de creation d'une ecriture manuelle — lignes dynamiques
 * (ajout/retrait cote client), equilibre debit/credit affiche en temps
 * reel pour guider la saisie, mais **jamais** la source de verite :
 * app_private.post_journal_entry reste la seule autorite sur l'invariant
 * (§ regles de securite UI, coherent avec le reste de Phase 1C/2A).
 * Aucun equilibre exige a la creation (brouillon desequilibre autorise,
 * construction en cours — meme invariant deja teste sur le chemin
 * automatique).
 */
export function ManualEntryForm({ journals, accounts }: { journals: Journal[]; accounts: Account[] }) {
  const [lines, setLines] = useState<Line[]>([{ ...EMPTY_LINE }, { ...EMPTY_LINE }])
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0)
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0)
  const balanced = totalDebit === totalCredit && totalDebit > 0

  function updateLine(index: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }

  function addLine() {
    setLines((prev) => [...prev, { ...EMPTY_LINE }])
  }

  function removeLine(index: number) {
    setLines((prev) => (prev.length > 2 ? prev.filter((_, i) => i !== index) : prev))
  }

  function handleSubmit(formData: FormData) {
    setError(null)
    const payload = lines
      .filter((l) => l.account_id && (Number(l.debit) > 0 || Number(l.credit) > 0))
      .map((l) => ({ account_id: l.account_id, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 }))
    formData.set('lines', JSON.stringify(payload))
    startTransition(async () => {
      try {
        await createManualJournalEntryAction(formData)
      } catch (err) {
        // createManualJournalEntryAction redirige vers la fiche en cas de
        // succes (redirect() de Next.js) — ce mecanisme leve une erreur
        // interne speciale qui doit continuer a se propager, jamais etre
        // affichee comme un echec (unstable_rethrow la laisse passer,
        // n'importe quelle autre erreur reelle est traitee normalement).
        unstable_rethrow(err)
        setError(err instanceof Error ? err.message : 'Echec de la creation.')
      }
    })
  }

  return (
    <form ref={formRef} action={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="journal_code" className="block text-xs font-medium text-mf-navy-900">Journal</label>
          <select id="journal_code" name="journal_code" required className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm">
            <option value="">—</option>
            {journals.map((j) => (
              <option key={j.id} value={j.code}>
                {j.code} — {j.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="entry_date" className="block text-xs font-medium text-mf-navy-900">Date</label>
          <input
            id="entry_date"
            type="date"
            name="entry_date"
            required
            defaultValue={new Date().toISOString().slice(0, 10)}
            className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm"
          />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label htmlFor="description" className="block text-xs font-medium text-mf-navy-900">Description</label>
          <input id="description" name="description" required className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-mf-navy-900">Lignes (au moins 2, une seule des deux colonnes par ligne)</p>
        {lines.map((line, i) => (
          <div key={i} className="grid grid-cols-12 items-center gap-2">
            <select
              value={line.account_id}
              onChange={(e) => updateLine(i, { account_id: e.target.value })}
              className="col-span-6 rounded-lg border border-mf-border px-3 py-2 text-sm"
            >
              <option value="">Compte —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.label}
                </option>
              ))}
            </select>
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="Debit"
              value={line.debit}
              onChange={(e) => updateLine(i, { debit: e.target.value, credit: e.target.value ? '' : line.credit })}
              className="col-span-2 rounded-lg border border-mf-border px-3 py-2 text-sm"
            />
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="Credit"
              value={line.credit}
              onChange={(e) => updateLine(i, { credit: e.target.value, debit: e.target.value ? '' : line.debit })}
              className="col-span-2 rounded-lg border border-mf-border px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={() => removeLine(i)}
              disabled={lines.length <= 2}
              className="col-span-2 text-xs text-mf-danger disabled:opacity-30"
            >
              Retirer
            </button>
          </div>
        ))}
        <button type="button" onClick={addLine} className="text-xs font-medium text-mf-navy-700 hover:underline">
          + Ajouter une ligne
        </button>
      </div>

      <p className={`text-sm ${balanced ? 'text-mf-emerald-600' : 'text-slate-500'}`}>
        Debit {totalDebit.toFixed(2)} — Credit {totalCredit.toFixed(2)}
        {balanced ? ' (equilibree)' : ' (brouillon desequilibre autorise, verifie au posting)'}
      </p>

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-mf-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-navy-800 disabled:opacity-60"
      >
        {pending ? 'Creation...' : "Creer le brouillon"}
      </button>
      {error && <p className="text-sm text-mf-danger">{error}</p>}
    </form>
  )
}
