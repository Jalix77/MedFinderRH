import { describe, it, expect } from 'vitest'
import { adminClient } from './helpers'

/**
 * Garde-fou `function_search_path_mutable` (lint Supabase).
 *
 * CONTEXTE — pourquoi ce fichier existe :
 * le Security Advisor REEL du projet cloud, rejoue manuellement par
 * Jean Alix Pierre le 18/08/2026, a signale
 * `app_private.chart_of_accounts_immutable_if_used` (livree en Phase 2A)
 * sans `search_path` fixe. Ma verification interne de l'epoque
 * (`debug_security_definer_without_search_path`) filtrait sur
 * `prosecdef` — SECURITY DEFINER UNIQUEMENT — alors que cette fonction
 * est une fonction TRIGGER ordinaire : elle etait STRUCTURELLEMENT hors
 * du champ de ma verification, qui ne pouvait donc pas la detecter.
 *
 * Ce fichier verrouille ce trou de detection en s'alignant sur le
 * perimetre reel du lint : TOUTES les fonctions des schemas applicatifs,
 * sans condition sur SECURITY DEFINER.
 *
 * PORTEE ET LIMITE, explicitement : ce test ne remplace PAS le Security
 * Advisor Supabase et ne permet jamais d'affirmer « 0 avertissement
 * Advisor ». Il detecte une REGRESSION de cette famille precise entre
 * deux rejeux manuels de l'Advisor — rien de plus.
 */
describe('Hardening search_path — alignement sur le lint Supabase function_search_path_mutable', () => {
  for (const schema of ['public', 'app_private']) {
    it(`aucune fonction du schema ${schema} n'a de search_path mutable (SECURITY DEFINER ou non)`, async () => {
      const admin = adminClient()
      const { data, error } = await admin.rpc('debug_functions_with_mutable_search_path', { p_schema: schema })
      expect(error).toBeNull()

      const offenders = (data ?? []) as { function_signature: string; is_security_definer: boolean }[]
      expect(
        offenders,
        `Fonctions sans "set search_path" dans ${schema} (seraient signalees ` +
          `function_search_path_mutable par le Security Advisor) : ` +
          offenders.map((o) => `${o.function_signature}${o.is_security_definer ? ' [SECURITY DEFINER]' : ''}`).join(', ')
      ).toEqual([])
    })
  }

  it('regression ciblee : chart_of_accounts_immutable_if_used a bien un search_path fixe (defaut signale par l\'Advisor le 18/08/2026)', async () => {
    const admin = adminClient()
    const { data, error } = await admin.rpc('debug_functions_with_mutable_search_path', { p_schema: 'app_private' })
    expect(error).toBeNull()

    const offenders = (data ?? []) as { function_signature: string }[]
    expect(
      offenders.some((o) => o.function_signature.startsWith('chart_of_accounts_immutable_if_used')),
      'chart_of_accounts_immutable_if_used ne doit plus apparaitre comme search_path mutable'
    ).toBe(false)
  })

  it('la verification historique (SECURITY DEFINER uniquement) reste verte, mais est un SOUS-ENSEMBLE de la precedente', async () => {
    const admin = adminClient()
    // Conservee telle quelle : elle reste utile, mais ce test documente
    // explicitement qu'elle est plus etroite que le lint reel — c'est
    // precisement cet ecart qui avait laisse passer le defaut.
    for (const schema of ['public', 'app_private']) {
      const { data, error } = await admin.rpc('debug_security_definer_without_search_path', { p_schema: schema })
      expect(error).toBeNull()
      expect(data ?? []).toEqual([])
    }
  })
})
