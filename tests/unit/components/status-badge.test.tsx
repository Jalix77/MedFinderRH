// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBadge } from '@/components/finance/status-badge'

describe('StatusBadge (§ regles UX : libelles metier, jamais un code technique brut)', () => {
  it('traduit un statut de depense en libelle francais metier', () => {
    render(<StatusBadge status="submitted" domain="expense" />)
    expect(screen.getByText('Soumise')).toBeInTheDocument()
    expect(screen.queryByText('submitted')).not.toBeInTheDocument()
  })

  it('traduit chaque statut du workflow depense (couverture exhaustive)', () => {
    const expected: Record<string, string> = {
      draft: 'Brouillon',
      submitted: 'Soumise',
      approved: 'Approuvee',
      rejected: 'Rejetee',
      committed: 'Engagee',
      paid: 'Payee — justificatif attendu',
      justified: 'Justifiee',
      posted: 'Comptabilisee',
      cancelled: 'Annulee',
    }
    for (const [status, label] of Object.entries(expected)) {
      const { unmount } = render(<StatusBadge status={status} domain="expense" />)
      expect(screen.getByText(label)).toBeInTheDocument()
      unmount()
    }
  })

  it('repli generique pour un statut de budget (ouvert/ferme/approuve)', () => {
    render(<StatusBadge status="approved" />)
    expect(screen.getByText('Approuve')).toBeInTheDocument()
  })

  it('affiche le code brut si aucun mapping ne correspond (jamais une valeur inventee)', () => {
    render(<StatusBadge status="code_inconnu_xyz" />)
    expect(screen.getByText('code_inconnu_xyz')).toBeInTheDocument()
  })
})
