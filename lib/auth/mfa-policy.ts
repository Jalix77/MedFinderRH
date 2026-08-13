/**
 * Logique MFA pure (aucun acces reseau/cookies) — separee de lib/auth/mfa.ts
 * (qui porte `import 'server-only'`) pour rester testable unitairement sans
 * environnement Next.js. Voir tests/unit/mfa-logic.test.ts.
 */

export type MfaAssurance = {
  // Supabase type ce niveau en "string & {}" (extensible) plutot qu'une
  // union litterale stricte — on le compare toujours a 'aal2' en valeur.
  currentLevel: string | null
  nextLevel: string | null
  hasVerifiedFactor: boolean
}

/** true si un second facteur existe mais n'a pas encore ete verifie sur cette session. */
export function needsMfaChallenge(assurance: MfaAssurance): boolean {
  return assurance.hasVerifiedFactor && assurance.currentLevel !== assurance.nextLevel
}

/** true si la politique exige un facteur MFA que l'utilisateur n'a pas encore enrole. */
export function needsMfaEnrollment(requiresMfa: boolean, assurance: MfaAssurance): boolean {
  return requiresMfa && !assurance.hasVerifiedFactor
}
