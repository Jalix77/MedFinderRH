import { describe, it, expect, beforeAll } from 'vitest'
import { signInAs, adminClient, getOrgIdByName } from './helpers'

describe('Numerotation automatique (docs/accounting-design.md §11)', () => {
  let orgA: string
  // entity_type unique par execution : le cloud partage n'est jamais
  // reinitialise entre deux lancements de la suite (SKIP_DB_RESET=1,
  // documente dans package.json). Un entity_type fixe ('test_entity')
  // faisait donc avancer le compteur a chaque run reel (TST-0001 la
  // premiere fois, TST-0002 la fois suivante, etc.), un artefact
  // d'environnement sans lien avec la logique testee — jamais reproduit en
  // local avec `supabase db reset`. Un entity_type distinct a chaque
  // execution garantit une sequence fraiche (demarre bien a 0001) sans
  // dependre d'une reinitialisation externe.
  const entityType = `test_entity_${Date.now()}`

  beforeAll(async () => {
    orgA = await getOrgIdByName('MedFinder Demo — Organisation A')
    const admin = adminClient()
    await admin.from('numbering_sequences').insert({
      organization_id: orgA,
      entity_type: entityType,
      prefix_pattern: 'TST-{seq:04d}',
      reset_rule: 'never',
    })
  })

  it('genere des numeros sequentiels formates, de maniere atomique', async () => {
    const { client } = await signInAs('rh.demo@medfinder.test')

    const { data: first, error: e1 } = await client.rpc('next_number', {
      p_org_id: orgA,
      p_entity_type: entityType,
    })
    expect(e1).toBeNull()
    expect(first).toBe('TST-0001')

    const { data: second } = await client.rpc('next_number', {
      p_org_id: orgA,
      p_entity_type: entityType,
    })
    expect(second).toBe('TST-0002')
  })

  it('refuse un appel concurrent depuis un utilisateur d\'une autre organisation (pas membre)', async () => {
    const { client } = await signInAs('orgb.demo@medfinder.test')
    const { error } = await client.rpc('next_number', {
      p_org_id: orgA,
      p_entity_type: entityType,
    })
    expect(error).toBeTruthy()
  })

  it('20 appels concurrents produisent 20 numeros uniques (pas de doublon sous concurrence)', async () => {
    const { client } = await signInAs('comptable.demo@medfinder.test')
    const admin = adminClient()
    await admin.from('numbering_sequences').insert({
      organization_id: orgA,
      entity_type: 'concurrency_test',
      prefix_pattern: 'CC-{seq:04d}',
      reset_rule: 'never',
    })

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        client.rpc('next_number', { p_org_id: orgA, p_entity_type: 'concurrency_test' })
      )
    )
    const numbers = results.map((r) => r.data as string)
    expect(new Set(numbers).size).toBe(20)
  })
})
