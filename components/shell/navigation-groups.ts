import type { NavItem } from '@/lib/navigation'

// Groupement visuel du stash ; aucune permission ni route n'est definie ici.
const GROUP_ORDER = ['Pilotage', 'Finance', 'Ressources humaines', 'Administration', 'Autres'] as const
type Group = (typeof GROUP_ORDER)[number]
const GROUP_OF: Record<string, Group> = {
  '/direction': 'Pilotage', '/audit': 'Pilotage',
  '/depenses': 'Finance', '/tiers': 'Finance', '/facturation': 'Finance',
  '/budget': 'Finance', '/tresorerie': 'Finance', '/comptabilite': 'Finance', '/papej': 'Finance',
  '/rh/employes': 'Ressources humaines', '/rh/departements': 'Ressources humaines',
  '/settings/organization': 'Administration', '/settings/users': 'Administration', '/settings/security': 'Administration',
}

export function groupItems(items: NavItem[]) {
  const buckets = new Map<Group, NavItem[]>()
  for (const item of items) {
    const group = GROUP_OF[item.href] ?? 'Autres'
    if (!buckets.has(group)) buckets.set(group, [])
    buckets.get(group)!.push(item)
  }
  return GROUP_ORDER.filter(group => buckets.has(group)).map(group => ({ group, items: buckets.get(group)! }))
}

export function navigationBreadcrumb(items: NavItem[], pathname: string): string[] {
  const active = items.filter(item => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]
  return active ? [GROUP_OF[active.href] ?? 'Autres', active.label] : ['MedFinder']
}
