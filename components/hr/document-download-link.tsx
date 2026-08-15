'use client'

import { useTransition } from 'react'
import { getEmployeeDocumentSignedUrlAction } from '@/app/actions/hr'

/**
 * Jamais d'URL de stockage directe : genere une URL signee a la demande
 * (60s de validite, voir app/actions/hr.ts) puis ouvre un nouvel onglet.
 */
export function DocumentDownloadLink({ documentId }: { documentId: string }) {
  const [pending, startTransition] = useTransition()

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          try {
            const url = await getEmployeeDocumentSignedUrlAction(documentId)
            window.open(url, '_blank', 'noopener,noreferrer')
          } catch {
            // Le lien reste simplement inactif visuellement le temps du retry ;
            // pas de gestion d'erreur elaboree necessaire pour Phase 1B.
          }
        })
      }
      className="text-xs font-medium text-mf-navy-700 hover:underline disabled:opacity-60"
    >
      {pending ? '...' : 'Telecharger'}
    </button>
  )
}
