// Etend `expect` avec les matchers jest-dom (toBeInTheDocument, etc.) pour
// les tests composants (tests/unit/components/*.test.tsx). Sans effet sur
// les tests d'integration/unitaires purs qui n'ont pas de DOM.
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// `test.globals` n'est pas active dans vitest.config.ts (evite de polluer
// les tests d'integration) — le nettoyage automatique entre tests de
// @testing-library/react ne se declenche donc pas tout seul : enregistre
// explicitement pour ne jamais laisser le rendu d'un test precedent
// polluer le suivant (source d'echecs "multiple elements found" sinon).
afterEach(() => {
  cleanup()
})
