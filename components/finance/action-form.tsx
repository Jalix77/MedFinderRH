'use client'

import { useRef, useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Enveloppe reutilisable pour toute action de workflow financier
 * (approuver, payer, annuler, ...) : protection double-soumission
 * (bouton desactive pendant l'appel, meme patron que
 * components/hr/document-upload.tsx), erreur backend affichee fidelement
 * — jamais une supposition cote client sur ce qui va se passer (§ regles
 * de securite UI, le backend reste l'autorite).
 */
export function ActionForm({
  action,
  hiddenFields = {},
  submitLabel,
  pendingLabel,
  className,
  buttonClassName,
  children,
  onSuccessMessage,
}: {
  action: (formData: FormData) => Promise<void>
  hiddenFields?: Record<string, string>
  submitLabel: string
  pendingLabel?: string
  className?: string
  buttonClassName?: string
  children?: ReactNode
  onSuccessMessage?: string
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const router = useRouter()

  function handleSubmit(formData: FormData) {
    setError(null)
    setSuccess(false)
    startTransition(async () => {
      try {
        await action(formData)
        formRef.current?.reset()
        setSuccess(true)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Echec de l\'action.')
      }
    })
  }

  return (
    <form ref={formRef} action={handleSubmit} className={className}>
      {Object.entries(hiddenFields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
      <button type="submit" disabled={pending} className={buttonClassName ?? defaultButtonClass} >
        {pending ? (pendingLabel ?? 'Envoi...') : submitLabel}
      </button>
      {error && <p className="mt-2 text-sm text-mf-danger">{error}</p>}
      {success && onSuccessMessage && <p className="mt-2 text-sm text-mf-emerald-600">{onSuccessMessage}</p>}
    </form>
  )
}

const defaultButtonClass =
  'rounded-lg bg-mf-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-navy-800 disabled:opacity-60'
