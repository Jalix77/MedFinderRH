import type { PermissionCode } from '@/lib/permissions/codes'

export type NavItem = {
  href: string
  label: string
  /** null = visible a tout utilisateur authentifie (aucune permission requise). */
  permission: PermissionCode | null
}

/**
 * Navigation — n'affiche que les modules reellement construits (§53 :
 * "afficher uniquement les modules autorises" s'applique aussi aux
 * modules qui n'existent pas encore). Finance/Compta/CRM arrivent en
 * phases ulterieures et seront ajoutes ici au fur et a mesure.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: '/direction', label: 'Accueil', permission: null },
  { href: '/rh/employes', label: 'Employes', permission: 'employee.view' },
  { href: '/rh/departements', label: 'Departements & postes', permission: null },
  { href: '/settings/organization', label: 'Organisation', permission: 'settings.manage' },
  { href: '/settings/users', label: 'Utilisateurs & roles', permission: 'user.manage' },
  { href: '/settings/security', label: 'Securite (MFA)', permission: null },
  { href: '/audit', label: 'Audit', permission: 'audit.view' },
]
