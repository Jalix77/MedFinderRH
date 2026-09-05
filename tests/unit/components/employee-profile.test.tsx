// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import {
  initials,
  statusLabel,
  statusTone,
  documentTypeLabel,
  StatusPill,
} from '@/components/hr/employee-profile/profile-primitives'
import { formatDay, formatDayShort } from '@/lib/format/day'

describe('initials', () => {
  it('prend la premiere lettre de chaque nom, en majuscules', () => {
    expect(initials('Jean Alix', 'Pierre')).toBe('JP')
    expect(initials('marie', 'dupont')).toBe('MD')
  })

  it('reste lisible si un nom est vide', () => {
    expect(initials('Jean', '')).toBe('J')
    expect(initials('', '')).toBe('?')
  })
})

describe('statut', () => {
  it('traduit les statuts employe connus', () => {
    expect(statusLabel('active')).toBe('Actif')
    expect(statusLabel('on_leave')).toBe('En conge')
    expect(statusLabel('terminated')).toBe('Sorti')
  })

  it('traduit les statuts contrat dans leur propre vocabulaire', () => {
    expect(statusLabel('active', 'contract')).toBe('En cours')
  })

  it("n'efface jamais un statut inconnu", () => {
    // Une fiche RH qui masque un statut qu'elle ne sait pas nommer ment
    // sur l'etat du dossier.
    expect(statusLabel('futur_statut')).toBe('futur_statut')
    expect(statusTone('futur_statut')).toBe('neutral')
  })

  it('rend le libelle traduit, pas la valeur technique', () => {
    render(<StatusPill status="terminated" />)
    expect(screen.getByText('Sorti')).toBeInTheDocument()
  })
})

describe('documentTypeLabel', () => {
  it('nomme les types connus et laisse passer les autres', () => {
    expect(documentTypeLabel('piece_identite')).toBe("Piece d'identite")
    expect(documentTypeLabel('inconnu')).toBe('inconnu')
  })
})

/**
 * Les colonnes `date` sont des dates civiles. Les faire passer par un
 * objet Date les expose a un decalage de fuseau : un 1er mars affiche
 * 28 fevrier sur un serveur a l'ouest de l'UTC.
 */
describe('formatDay', () => {
  it('formate une date civile sans jamais construire de Date', () => {
    expect(formatDay('2026-03-01')).toBe('1 mars 2026')
    expect(formatDayShort('2026-03-01')).toBe('01/03/2026')
  })

  it('ne decale pas le premier jour du mois', () => {
    expect(formatDay('2026-01-01')).toBe('1 janvier 2026')
    expect(formatDay('2026-12-31')).toBe('31 decembre 2026')
  })

  it('rend un tiret sur une valeur absente', () => {
    expect(formatDay(null)).toBe('—')
    expect(formatDayShort(undefined)).toBe('—')
  })
})

/**
 * Garde-fou statique : le redesign ne devait deplacer aucune regle
 * d'acces. On verifie que les gardes d'origine sont toujours ecrites
 * dans la page — c'est ce qui distingue une refonte visuelle d'une
 * refonte de permissions.
 */
describe('fiche employe — gardes de permission', () => {
  const source = fs.readFileSync(
    path.join(path.resolve(__dirname, '../../..'), 'app/(app)/rh/employes/[id]/page.tsx'),
    'utf8'
  )

  it('conserve les six permissions et la garde de vue', () => {
    for (const permission of [
      'employee.view',
      'employee.update',
      'employee.terminate',
      'employee.view_sensitive',
      'employee.view_salary',
      'contract.manage',
      'document.upload',
    ]) {
      expect(source).toContain(permission)
    }
    expect(source).toMatch(/if \(!canView && !isSelf\) return <AccessDenied \/>/)
  })

  it('ne charge les donnees sensibles et les contrats que sous leur garde', () => {
    expect(source).toMatch(/canViewSensitive \|\| isSelf\s*\n?\s*\?\s*supabase\.from\('employee_sensitive_data'\)/)
    expect(source).toMatch(/canViewSalary \|\| isSelf\s*\n?\s*\?\s*supabase\.from\('contracts'\)/)
  })

  it('n\'utilise aucun client privilegie', () => {
    expect(source).not.toMatch(/service_role|SERVICE_ROLE|createAdminClient/)
  })

  /**
   * updateEmployeeAction lit `formData.get('gender') || null`. Un
   * formulaire de profil qui ne soumet pas le champ ecrase donc le genre
   * a NULL a chaque enregistrement, sans erreur ni trace visible.
   */
  it('le formulaire de profil soumet gender pour ne pas l\'ecraser', () => {
    const start = source.indexOf('action={updateEmployeeAction}')
    expect(start).toBeGreaterThan(-1)
    const form = source.slice(start, source.indexOf('</form>', start))
    expect(form).toMatch(/name="gender"/)
    expect(form).toMatch(/value=\{employee\.gender \?\? ''\}/)
  })
})

/**
 * Preuve de bout en bout du mecanisme : ce que le champ cache met dans le
 * FormData, une fois passe par la coercition de l'action, doit redonner la
 * valeur d'origine — y compris `null` quand le genre n'est pas renseigne.
 */
describe('preservation de gender a l\'enregistrement du profil', () => {
  /** Reproduit exactement `formData.get('gender') || null` cote action. */
  const asActionReads = (form: HTMLFormElement) => new FormData(form).get('gender') || null

  function renderProfileForm(gender: string | null) {
    const { container } = render(
      <form>
        <input type="hidden" name="id" value="emp-1" />
        <input type="hidden" name="gender" value={gender ?? ''} />
        <input name="first_name" defaultValue="Jean" />
      </form>
    )
    return container.querySelector('form') as HTMLFormElement
  }

  it('renvoie un genre renseigne inchange', () => {
    expect(asActionReads(renderProfileForm('F'))).toBe('F')
  })

  it('accepte les quatre valeurs autorisees par le schema', () => {
    for (const value of ['F', 'M', 'autre', 'non_precise']) {
      expect(asActionReads(renderProfileForm(value))).toBe(value)
    }
  })

  it('laisse null quand le genre n\'est pas renseigne', () => {
    // La chaine vide doit redevenir null, pas devenir une valeur refusee
    // par le check constraint.
    expect(asActionReads(renderProfileForm(null))).toBeNull()
  })
})
