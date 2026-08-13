import { describe, it, expect, beforeAll } from 'vitest'
import { signInAs, adminClient, getOrgIdByName } from './helpers'

describe('Numerotation automatique (docs/accounting-design.md §11)', () => {
  let orgA: string

  beforeAll(async () => {
    orgA = await getOrgIdByName('MedFinder Demo — Organisation A')
    const admin = adminClient()
    await admin.from('numbering_sequences').insert({
      organization_id: orgA,
      entity_type: 'test_entity',
      prefix_pattern: 'TST-{seq:04d}',
      reset_rule: 'never',
    })
  })

  it('genere des numeros sequentiels formates, de maniere atomique', async () => {
    const { client } = await signInAs('rh.demo@medfinder.test')

    const { data: first, error: e1 } = await client.rpc('next_number', {
      p_org_id: orgA,
      p_entity_type: 'test_entity',
    })
    expect(e1).toBeNull()
    expect(first).toBe('TST-0001')

    const { data: second } = await client.rpc('next_number', {
      p_org_id: orgA,
      p_entity_type: 'test_entity',
    })
    expect(second).toBe('TST-0002')
  })

  it('refuse un appel concurrent depuis un utilisateur d\'une autre organisation (pas membre)', async () => {
    const { client } = await signInAs('orgb.demo@medfinder.test')
    const { error } = await client.rpc('next_number', {
      p_org_id: orgA,
      p_entity_type: 'test_entity',
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
