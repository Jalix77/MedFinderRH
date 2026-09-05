'use client'

import Image from 'next/image'
import { useState } from 'react'

/** Initiales de l'employe, jamais plus de deux lettres. */
export function initials(firstName: string, lastName: string): string {
  return `${firstName.trim().charAt(0)}${lastName.trim().charAt(0)}`.toUpperCase() || '?'
}

function Photo({ url, name, fallback }: { url: string; name: string; fallback: string }) {
  const [failed, setFailed] = useState(false)
  return failed ? <span aria-hidden>{fallback}</span> : (
    <Image
      src={url}
      alt={name}
      width={96}
      height={96}
      unoptimized
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="h-full w-full rounded-full object-cover object-center"
    />
  )
}

/** Le positionnement porte uniquement sur le cercle, jamais sur l'identite. */
export function Avatar({ firstName, lastName, photoUrl, className = '' }: {
  firstName: string
  lastName: string
  photoUrl?: string
  className?: string
}) {
  const fallback = initials(firstName, lastName)
  return (
    <div className={`relative z-10 flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-mf-navy-900 text-2xl font-semibold tracking-wide text-white shadow-sm ring-4 ring-white sm:h-24 sm:w-24 sm:text-3xl ${className}`}>
      {photoUrl
        ? <Photo key={photoUrl} url={photoUrl} name={`${firstName} ${lastName}`.trim()} fallback={fallback} />
        : <span aria-hidden>{fallback}</span>}
    </div>
  )
}
