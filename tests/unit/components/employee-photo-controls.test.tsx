// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PhotoControls } from '@/components/hr/employee-profile/photo-controls'

const mocks = vi.hoisted(() => ({ upload: vi.fn(), remove: vi.fn(), refresh: vi.fn() }))
vi.mock('@/app/actions/employee-photos', () => ({
  uploadEmployeeProfilePhotoAction: mocks.upload,
  removeEmployeeProfilePhotoAction: mocks.remove,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
beforeEach(() => {
  vi.clearAllMocks()
  mocks.upload.mockResolvedValue({})
  mocks.remove.mockResolvedValue({})
})

describe('controles photo', () => {
  it('ajoute le fichier choisi et le contexte employe, puis actualise', async () => {
    render(<PhotoControls employeeId="emp-1" hasPhoto={false} />)
    expect(screen.queryByRole('button', { name: 'Supprimer' })).not.toBeInTheDocument()
    const input = screen.getByLabelText('Ajouter une photo')
    expect(input).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp')
    const file = new File(['image'], 'photo.png', { type: 'image/png' })
    await userEvent.setup().upload(input, file)
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1))
    const data = mocks.upload.mock.calls[0][0] as FormData
    expect(data.get('employee_id')).toBe('emp-1')
    expect(data.get('file')).toBe(file)
    expect(mocks.refresh).toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('Photo enregistrée.')
  })
  it('pending empeche les doubles soumissions et la suppression simultanee', async () => {
    let complete!: (value: object) => void
    mocks.upload.mockReturnValue(new Promise((resolve) => { complete = resolve }))
    render(<PhotoControls employeeId="emp-1" hasPhoto />)
    await userEvent.setup().upload(screen.getByLabelText('Changer la photo'), new File(['x'], 'x.jpg', { type: 'image/jpeg' }))
    expect(screen.getByRole('button', { name: 'En cours…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Supprimer' })).toBeDisabled()
    await act(async () => complete({}))
    expect(screen.getByRole('button', { name: 'Changer la photo' })).not.toBeDisabled()
  })
  it('suppression reussie affiche le feedback et actualise', async () => {
    render(<PhotoControls employeeId="emp-1" hasPhoto />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Supprimer' }))
    expect(mocks.remove.mock.calls[0][0].get('employee_id')).toBe('emp-1')
    expect(screen.getByRole('status')).toHaveTextContent('Photo supprimée.')
    expect(mocks.refresh).toHaveBeenCalled()
  })
  it('erreur serveur lisible, sans faux succes ni actualisation', async () => {
    mocks.remove.mockResolvedValue({ error: 'Permission refusée.' })
    render(<PhotoControls employeeId="emp-1" hasPhoto />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Supprimer' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Permission refusée.')
    expect(mocks.refresh).not.toHaveBeenCalled()
  })
  it('fichier refuse cote client avant tout appel', async () => {
    render(<PhotoControls employeeId="emp-1" hasPhoto={false} />)
    await userEvent.setup({ applyAccept: false }).upload(screen.getByLabelText('Ajouter une photo'),
      new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' }))
    expect(screen.getByRole('alert')).toHaveTextContent('JPEG, PNG ou WebP')
    expect(mocks.upload).not.toHaveBeenCalled()
  })
  it('avertissement de nettoyage reste visible apres succes', async () => {
    mocks.remove.mockResolvedValue({ warning: 'Photo retirée, nettoyage impossible.' })
    render(<PhotoControls employeeId="emp-1" hasPhoto />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Supprimer' }))
    expect(screen.getByRole('status')).toHaveTextContent('nettoyage impossible')
    expect(mocks.refresh).toHaveBeenCalled()
  })
})
