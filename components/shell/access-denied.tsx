export function AccessDenied() {
  return (
    <div className="rounded-2xl border border-mf-border bg-mf-surface p-8 text-center shadow-sm">
      <h1 className="text-lg font-semibold text-mf-navy-900">Acces refuse</h1>
      <p className="mt-2 text-sm text-slate-500">
        Vous n&apos;avez pas la permission necessaire pour consulter cette page.
      </p>
    </div>
  )
}
