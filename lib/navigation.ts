import type { PermissionCode } from '@/lib/permissions/codes'

export type NavItem = {
  href: string
  label: string
  /** null = visible a tout utilisateur authentifie (aucune permission requise). */
  permission: PermissionCode | null
}

/**
 * Navigation Phase 1A — n'affiche que les modules reellement construits
 * (§53 : "afficher uniquement les modules autorises" s'applique aussi aux
 * modules qui n'existent pas encore). Les modules RH/Finance/Compta/CRM
 * arrivent en Phase 1B+ et seront ajoutes ici au fur et a mesure.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: '/direction', label: 'Accueil', permission: null },
  { href: '/settings/organization', label: 'Organisation', permission: 'settings.manage' },
  { href: '/settings/users', label: 'Utilisateurs & roles', permission: 'user.manage' },
  { href: '/settings/security', label: 'Securite (MFA)', permission: null },
  { href: '/audit', label: 'Audit', permission: 'audit.view' },
]
