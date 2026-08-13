'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { unenrollFactorAction } from '@/app/actions/mfa'

export function MfaUnenrollButton({ factorId }: { factorId: string }) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await unenrollFactorAction(factorId)
          router.refresh()
        })
      }
      className="rounded-lg border border-mf-border px-3 py-1.5 text-xs font-medium text-mf-danger hover:bg-red-50 disabled:opacity-60"
    >
      {pending ? 'Suppression...' : 'Desactiver'}
    </button>
  )
}
