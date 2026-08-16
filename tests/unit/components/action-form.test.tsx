// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ActionForm } from '@/components/finance/action-form'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

/**
 * ActionForm est l'enveloppe reutilisee par tout bouton de workflow
 * financier (approuver, payer, annuler...) — ce test couvre directement
 * les deux exigences de securite UI de Phase 1C-UI : protection
 * double-soumission et affichage fidele de l'erreur backend (deja prouve
 * en E2E reel, ce test isole la logique du composant sans navigateur).
 */
describe('ActionForm', () => {
  it('desactive le bouton pendant l\'action (protection double-soumission)', async () => {
    const user = userEvent.setup()
    let resolveAction: () => void
    const action = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveAction = resolve
        })
    )

    render(<ActionForm action={action} submitLabel="Approuver" pendingLabel="Approbation..." />)

    const button = screen.getByRole('button', { name: 'Approuver' })
    await user.click(button)

    // Des le premier clic : libelle "pending" et bouton desactive — un
    // second clic pendant ce laps de temps ne peut pas re-declencher l'action.
    expect(screen.getByRole('button', { name: 'Approbation...' })).toBeDisabled()
    expect(action).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Approbation...' }))
    expect(action).toHaveBeenCalledTimes(1) // toujours 1 : le clic sur un bouton disabled est un no-op

    resolveAction!()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Approuver' })).not.toBeDisabled())
  })

  it('affiche fidelement le message d\'erreur renvoye par le backend, sans supposition cote client', async () => {
    const user = userEvent.setup()
    const action = vi.fn().mockRejectedValue(new Error('Vous ne pouvez pas approuver votre propre demande.'))

    render(<ActionForm action={action} submitLabel="Approuver" />)
    await user.click(screen.getByRole('button', { name: 'Approuver' }))

    await waitFor(() =>
      expect(screen.getByText('Vous ne pouvez pas approuver votre propre demande.')).toBeInTheDocument()
    )
  })

  it('transmet les champs caches fournis (contexte de l\'action, ex. id de la ressource)', async () => {
    const user = userEvent.setup()
    const action = vi.fn().mockResolvedValue(undefined)

    render(<ActionForm action={action} hiddenFields={{ id: 'expense-123', decision: 'approved' }} submitLabel="Approuver" />)
    await user.click(screen.getByRole('button', { name: 'Approuver' }))

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1))
    const formData = action.mock.calls[0][0] as FormData
    expect(formData.get('id')).toBe('expense-123')
    expect(formData.get('decision')).toBe('approved')
  })
})
