'use client'

import { useTransition } from 'react'
import { getExpenseAttachmentSignedUrlAction } from '@/app/actions/expenses'

/**
 * Meme patron que components/hr/document-download-link.tsx : jamais d'URL
 * de stockage directe, URL signee generee a la demande (60s de validite).
 */
export function AttachmentDownloadLink({ attachmentId }: { attachmentId: string }) {
  const [pending, startTransition] = useTransition()

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          try {
            const url = await getExpenseAttachmentSignedUrlAction(attachmentId)
            window.open(url, '_blank', 'noopener,noreferrer')
          } catch {
            // Lien inactif le temps du retry — pas de gestion d'erreur elaboree.
          }
        })
      }
      className="text-xs font-medium text-mf-navy-700 hover:underline disabled:opacity-60"
    >
      {pending ? '...' : 'Telecharger'}
    </button>
  )
}
