import type { PermissionCode } from '@/lib/permissions/codes'

export type NavItem = {
  href: string
  label: string
  /**
   * null = visible a tout utilisateur authentifie (aucune permission requise).
   * Un tableau = visible si l'utilisateur detient AU MOINS UNE des
   * permissions listees (ex. Depenses : visible avec expense.view *ou*
   * expense.create seul, cas d'AGENT_TERRAIN qui ne voit que ses propres
   * demandes sans jamais avoir expense.view).
   */
  permission: PermissionCode | PermissionCode[] | null
}

/**
 * Navigation — n'affiche que les modules reellement construits (§53 :
 * "afficher uniquement les modules autorises" s'applique aussi aux
 * modules qui n'existent pas encore). CRM/Payroll/Dons arrivent en phases
 * ulterieures et seront ajoutes ici au fur et a mesure.
 *
 * Rappel de securite (Phase 1C-UI, regles UX) : ce filtrage n'est qu'une
 * commodite d'affichage — la protection reelle reste RLS/RBAC cote base,
 * verifiee independamment sur chaque page et chaque Server Action.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: '/direction', label: 'Accueil', permission: null },
  { href: '/rh/employes', label: 'Employes', permission: 'employee.view' },
  { href: '/rh/departements', label: 'Departements & postes', permission: null },
  { href: '/depenses', label: 'Depenses', permission: ['expense.view', 'expense.create'] },
  { href: '/budget', label: 'Budget', permission: 'budget.view' },
  { href: '/tresorerie', label: 'Tresorerie', permission: ['treasury.manage', 'accounting.view'] },
  { href: '/papej', label: 'PAPEJ', permission: 'papej.view' },
  { href: '/settings/organization', label: 'Organisation', permission: 'settings.manage' },
  { href: '/settings/users', label: 'Utilisateurs & roles', permission: 'user.manage' },
  { href: '/settings/security', label: 'Securite (MFA)', permission: null },
  { href: '/audit', label: 'Audit', permission: 'audit.view' },
]
