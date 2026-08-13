import type { ReactNode } from 'react'

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-mf-navy-950 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-mf-emerald-500">
            MedFinder Haiti
          </p>
          <h1 className="mt-1 text-xl font-bold text-white">MedFinder Gestion</h1>
        </div>
        <div className="rounded-2xl bg-mf-surface p-8 shadow-xl">{children}</div>
      </div>
    </div>
  )
}
