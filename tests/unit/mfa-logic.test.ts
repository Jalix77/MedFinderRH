import { describe, it, expect } from 'vitest'
import { needsMfaChallenge, needsMfaEnrollment, type MfaAssurance } from '@/lib/auth/mfa-policy'

describe('needsMfaChallenge', () => {
  it('faux si aucun facteur verifie', () => {
    const assurance: MfaAssurance = { currentLevel: 'aal1', nextLevel: 'aal1', hasVerifiedFactor: false }
    expect(needsMfaChallenge(assurance)).toBe(false)
  })

  it('vrai si facteur verifie mais session encore aal1 (next=aal2)', () => {
    const assurance: MfaAssurance = { currentLevel: 'aal1', nextLevel: 'aal2', hasVerifiedFactor: true }
    expect(needsMfaChallenge(assurance)).toBe(true)
  })

  it('faux si facteur verifie et session deja aal2', () => {
    const assurance: MfaAssurance = { currentLevel: 'aal2', nextLevel: 'aal2', hasVerifiedFactor: true }
    expect(needsMfaChallenge(assurance)).toBe(false)
  })
})

describe('needsMfaEnrollment', () => {
  it('vrai si la politique exige MFA et aucun facteur n\'existe', () => {
    const assurance: MfaAssurance = { currentLevel: 'aal1', nextLevel: 'aal1', hasVerifiedFactor: false }
    expect(needsMfaEnrollment(true, assurance)).toBe(true)
  })

  it('faux si la politique n\'exige pas MFA', () => {
    const assurance: MfaAssurance = { currentLevel: 'aal1', nextLevel: 'aal1', hasVerifiedFactor: false }
    expect(needsMfaEnrollment(false, assurance)).toBe(false)
  })

  it('faux si un facteur est deja enrole, meme si la session n\'a pas encore franchi le defi', () => {
    const assurance: MfaAssurance = { currentLevel: 'aal1', nextLevel: 'aal2', hasVerifiedFactor: true }
    expect(needsMfaEnrollment(true, assurance)).toBe(false)
  })
})
