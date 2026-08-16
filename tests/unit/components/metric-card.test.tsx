// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MetricCard } from '@/components/finance/metric-card'

describe('MetricCard (§ regles UX : le DG lit un libelle metier, pas un nom de colonne)', () => {
  it('affiche le libelle et la valeur fournis', () => {
    render(<MetricCard label="Budget disponible" value="458 500,00 HTG" />)
    expect(screen.getByText('Budget disponible')).toBeInTheDocument()
    expect(screen.getByText('458 500,00 HTG')).toBeInTheDocument()
  })

  it('affiche un indice complementaire quand fourni', () => {
    render(<MetricCard label="Depenses en attente" value="3" hint="Necessite une approbation" />)
    expect(screen.getByText('Necessite une approbation')).toBeInTheDocument()
  })

  it('applique une tonalite d\'alerte visuelle pour les valeurs critiques (warning/danger)', () => {
    const { container: warn } = render(<MetricCard label="X" value="5" tone="warning" />)
    expect(warn.querySelector('.text-amber-600')).toBeTruthy()

    const { container: danger } = render(<MetricCard label="Justificatifs manquants" value="2" tone="danger" />)
    expect(danger.querySelector('.text-mf-danger')).toBeTruthy()
  })
})
