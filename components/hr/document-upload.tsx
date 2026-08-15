'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { uploadEmployeeDocumentAction } from '@/app/actions/hr'

const DOCUMENT_TYPES = [
  { value: 'contrat_signe', label: 'Contrat signe' },
  { value: 'piece_identite', label: "Piece d'identite" },
  { value: 'diplome', label: 'Diplome' },
  { value: 'cv', label: 'CV' },
  { value: 'justificatif', label: 'Justificatif' },
  { value: 'autre', label: 'Autre' },
]

export function DocumentUpload({ employeeId }: { employeeId: string }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const router = useRouter()

  function handleSubmit(formData: FormData) {
    setError(null)
    startTransition(async () => {
      try {
        await uploadEmployeeDocumentAction(formData)
        formRef.current?.reset()
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Echec du televersement.')
      }
    })
  }

  return (
    <form ref={formRef} action={handleSubmit} className="flex flex-wrap items-end gap-3 border-t border-mf-border pt-3">
      <input type="hidden" name="employee_id" value={employeeId} />
      <div>
        <label className="block text-xs font-medium text-mf-navy-900">Type</label>
        <select name="type" className="mt-1 rounded-lg border border-mf-border px-3 py-2 text-sm">
          {DOCUMENT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-mf-navy-900">Fichier</label>
        <input
          type="file"
          name="file"
          required
          className="mt-1 block text-sm"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-mf-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-navy-800 disabled:opacity-60"
      >
        {pending ? 'Envoi...' : 'Deposer'}
      </button>
      {error && <p className="w-full text-sm text-mf-danger">{error}</p>}
    </form>
  )
}
