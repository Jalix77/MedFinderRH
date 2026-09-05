'use client'

import { useId, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { uploadEmployeeProfilePhotoAction, removeEmployeeProfilePhotoAction } from '@/app/actions/employee-photos'
import { EMPLOYEE_PHOTO_ACCEPT, validateEmployeePhoto } from '@/lib/storage/employee-photo'

export function PhotoControls({ employeeId, hasPhoto }: { employeeId: string; hasPhoto: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const helpId = useId()
  const [pending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null)
  const router = useRouter()
  const label = hasPhoto ? 'Changer la photo' : 'Ajouter une photo'

  function submit(file?: File) {
    setFeedback(null)
    if (file) {
      const error = validateEmployeePhoto(file)
      if (error) {
        setFeedback({ text: error, error: true })
        return
      }
    }
    const data = new FormData()
    data.set('employee_id', employeeId)
    if (file) data.set('file', file)
    startTransition(async () => {
      try {
        const result = file
          ? await uploadEmployeeProfilePhotoAction(data)
          : await removeEmployeeProfilePhotoAction(data)
        setFeedback({
          text: result.error ?? result.warning ?? (file ? 'Photo enregistrée.' : 'Photo supprimée.'),
          error: Boolean(result.error),
        })
        if (!result.error) router.refresh()
      } catch {
        setFeedback({ text: 'La modification a échoué. Réessayez.', error: true })
      }
    })
  }

  return (
    <div className="mt-2 text-xs">
      <input
        ref={input}
        type="file"
        accept={EMPLOYEE_PHOTO_ACCEPT}
        aria-label={label}
        aria-describedby={helpId}
        disabled={pending}
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) submit(file)
        }}
      />
      <span id={helpId} className="sr-only">JPEG, PNG ou WebP, 3 MiB maximum.</span>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button type="button" disabled={pending} onClick={() => input.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-full border border-mf-border px-2.5 py-1 font-medium text-mf-navy-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50">
          <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-3.5 w-3.5">
            <path d="M8 5l1-2h6l1 2h4v15H4V5h4z" strokeLinejoin="round" />
            <circle cx="12" cy="12" r="4" />
          </svg>
          {pending ? 'En cours…' : label}
        </button>
        {hasPhoto && <button type="button" disabled={pending} onClick={() => submit()}
          className="rounded px-1 py-1 text-slate-500 hover:text-mf-danger hover:underline focus-visible:outline-2 disabled:opacity-50">
          Supprimer
        </button>}
      </div>
      <div role={feedback?.error ? 'alert' : 'status'} aria-live="polite">
        {feedback && <p className={`mt-1 ${feedback.error ? 'text-mf-danger' : 'text-slate-500'}`}>{feedback.text}</p>}
      </div>
    </div>
  )
}
