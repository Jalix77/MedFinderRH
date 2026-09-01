'use client'

import { useRef, useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Resultat d'une action qui MODELISE son refus comme valeur de retour au
 * lieu de lever une exception.
 *
 * Pourquoi c'est necessaire : une Error levee depuis une Server Action est
 * remplacee par React, en build de PRODUCTION, par un message generique
 * (« Minified React error #441 », emis par resolveErrorProd dans le client
 * RSC) afin de ne pas divulguer de detail serveur. Le motif reel du refus
 * est donc PERDU pour l'operateur des qu'on quitte le mode developpement.
 * La documentation Next livree avec cette version le dit explicitement
 * (node_modules/next/dist/docs/01-app/01-getting-started/10-error-handling.md) :
 * « avoid using try/catch blocks and throw errors. Instead, model expected
 * errors as return values. »
 *
 * Un refus de regle metier (separation des fonctions, autorite requise,
 * statut invalide) est une erreur ATTENDUE : il doit voyager comme valeur.
 * Les exceptions restent reservees aux pannes reelles.
 */
export type ActionFormResult = { error?: string } | void

/**
 * Enveloppe reutilisable pour toute action de workflow financier
 * (approuver, payer, annuler, ...) : protection double-soumission
 * (bouton desactive pendant l'appel, meme patron que
 * components/hr/document-upload.tsx), erreur backend affichee fidelement
 * — jamais une supposition cote client sur ce qui va se passer (§ regles
 * de securite UI, le backend reste l'autorite).
 *
 * Deux conventions d'echec sont acceptees, sans rien casser de l'existant :
 * une action peut lever (comportement historique) ou renvoyer
 * `{ error }`. Les actions qui ne renvoient rien restent inchangees.
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
  action: (formData: FormData) => Promise<ActionFormResult>
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
        const result = await action(formData)
        // Refus modelise comme valeur : le formulaire n'est ni reinitialise
        // ni rafraichi, et le motif reel reste lisible en production.
        if (result && result.error) {
          setError(result.error)
          return
        }
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
