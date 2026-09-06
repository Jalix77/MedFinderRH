'use client'

import { useEffect, type ReactNode } from 'react'
import { mountSpecular } from './engine'

export function SpecularSurfaceProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const scope = document.querySelector<HTMLElement>('[data-mf-app]')
    if (scope) return mountSpecular(scope)
  }, [])
  return children
}
