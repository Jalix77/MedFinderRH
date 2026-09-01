'use client'

import { useState, useTransition } from 'react'
import { unstable_rethrow } from 'next/navigation'

type MovementOption = { id: string; label: string; direction: string; amount: number }

/**
 * Rapprochement MANUEL d'une ligne de releve avec un mouvement de
 * tresorerie (Phase 2D).
 *
 * L'ecran ne filtre que par confort (mouvements du meme compte, meme
 * devise, non deja engages). Toutes les regles reelles — sens, devise,
 * organisation, double rapprochement, mesure des ecarts — sont
 * revalidees par `create_manual_bank_match`, qui reste l'autorite et
 * dont le refus est affiche tel quel.
 */
export function ManualMatchForm({
  action,
  statementLineId,
  importId,
  movements,
}: {
  action: (formData: FormData) => Promise<void>
  statementLineId: string
  importId: string
  movements: MovementOption[]
}) {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleSubmit(formData: FormData) {
    setError(null)
    startTransition(async () => {
      try {
        await action(formData)
      } catch (err) {
        unstable_rethrow(err)
        setError(err instanceof Error ? err.message : 'Rapprochement impossible.')
      }
    })
  }

  if (movements.length === 0) {
    return <span className="text-xs text-slate-400">Aucun mouvement disponible</span>
  }

  return (
    <details>
      <summary className="cursor-pointer text-xs font-semibold text-mf-navy-700">Rapprocher</summary>
      <form action={handleSubmit} className="mt-2 space-y-2">
        <input type="hidden" name="statement_line_id" value={statementLineId} />
        <input type="hidden" name="import_id" value={importId} />

        <select name="cash_movement_id" required aria-label="Mouvement de tresorerie"
          className="w-full rounded-lg border border-mf-border px-2 py-1 text-xs">
          <option value="">— Choisir un mouvement —</option>
          {movements.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>

        <input name="notes" placeholder="Note (optionnel)"
          className="w-full rounded-lg border border-mf-border px-2 py-1 text-xs" />

        {error && <p role="alert" className="rounded bg-red-50 px-2 py-1 text-xs text-mf-danger">{error}</p>}

        <button type="submit" disabled={pending}
          className="rounded-lg border border-mf-border px-3 py-1 text-xs font-semibold text-mf-navy-700 hover:bg-slate-50 disabled:opacity-60">
          {pending ? 'Envoi…' : 'Proposer ce rapprochement'}
        </button>
        <p className="text-xs text-slate-400">
          Un ecart de montant ou de date est autorise mais sera enregistre explicitement.
        </p>
      </form>
    </details>
  )
}
