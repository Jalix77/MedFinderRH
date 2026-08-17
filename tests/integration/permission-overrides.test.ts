import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { signInAs, adminClient, getOrgIdByName } from './helpers'

/**
 * Verifie les overrides individuels ALLOW/DENY (user_permission_overrides)
 * et leur regle de priorite : "revoke" gagne toujours sur le role-grant et
 * sur un autre override "grant" (deny wins) — voir security.md §2 et
 * app_private.has_permission().
 */
describe('Overrides de permission individuels (ALLOW/DENY)', () => {
  let orgA: string
  let employeUserId: string
  const overrideIds: string[] = []

  beforeAll(async () => {
    orgA = await getOrgIdByName('MedFinder Demo — Organisation A')
    const admin = adminClient()
    const { data: employe } = await admin
      .from('users')
      .select('id')
      .eq('full_name', 'Demo Employe')
      .single()
    employeUserId = (employe as { id: string }).id
  })

  afterAll(async () => {
    if (overrideIds.length === 0) return
    const admin = adminClient()
    await admin.from('user_permission_overrides').delete().in('id', overrideIds)
  })

  it('EMPLOYE n\'a pas employee.create par defaut', async () => {
    const { client } = await signInAs('employe.demo@medfinder.test')
    const { data } = await client.rpc('current_user_has_permission', {
      p_org_id: orgA,
      p_permission_code: 'employee.create',
    })
    expect(data).toBe(false)
  })

  it('un override GRANT accorde employee.create a cet EMPLOYE precis', async () => {
    const admin = adminClient()
    const { data: permission } = await admin
      .from('permissions')
      .select('id')
      .eq('code', 'employee.create')
      .single()

    const { data: override, error } = await admin
      .from('user_permission_overrides')
      .insert({
        user_id: employeUserId,
        organization_id: orgA,
        permission_id: (permission as { id: string }).id,
        effect: 'grant',
        reason: 'Test integration — override GRANT',
        granted_by: employeUserId,
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    overrideIds.push((override as { id: string }).id)

    const { client } = await signInAs('employe.demo@medfinder.test')
    const { data } = await client.rpc('current_user_has_permission', {
      p_org_id: orgA,
      p_permission_code: 'employee.create',
    })
    expect(data).toBe(true)
  })

  it('un override REVOKE l\'emporte sur le role-grant par defaut (deny wins)', async () => {
    const admin = adminClient()
    const { data: permission } = await admin
      .from('permissions')
      .select('id')
      .eq('code', 'leave.request')
      .single()

    // leave.request est accorde par defaut a EMPLOYE — on le revoque
    // individuellement pour ce compte precis.
    const { data: override, error } = await admin
      .from('user_permission_overrides')
      .insert({
        user_id: employeUserId,
        organization_id: orgA,
        permission_id: (permission as { id: string }).id,
        effect: 'revoke',
        reason: 'Test integration — override REVOKE',
        granted_by: employeUserId,
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    overrideIds.push((override as { id: string }).id)

    const { client } = await signInAs('employe.demo@medfinder.test')
    const { data } = await client.rpc('current_user_has_permission', {
      p_org_id: orgA,
      p_permission_code: 'leave.request',
    })
    expect(data, 'revoke doit l\'emporter meme si le role l\'accorde par defaut').toBe(false)
  })

  it('un override REVOKE l\'emporte meme sur un override GRANT concurrent', async () => {
    const admin = adminClient()
    const { data: permission } = await admin
      .from('permissions')
      .select('id')
      .eq('code', 'audit.view')
      .single()

    const { data: grantOverride } = await admin
      .from('user_permission_overrides')
      .insert({
        user_id: employeUserId,
        organization_id: orgA,
        permission_id: (permission as { id: string }).id,
        effect: 'grant',
        reason: 'Test integration — grant concurrent',
        granted_by: employeUserId,
      })
      .select('id')
      .single()
    overrideIds.push((grantOverride as { id: string }).id)

    const { data: revokeOverride } = await admin
      .from('user_permission_overrides')
      .insert({
        user_id: employeUserId,
        organization_id: orgA,
        permission_id: (permission as { id: string }).id,
        effect: 'revoke',
        reason: 'Test integration — revoke concurrent',
        granted_by: employeUserId,
      })
      .select('id')
      .single()
    overrideIds.push((revokeOverride as { id: string }).id)

    const { client } = await signInAs('employe.demo@medfinder.test')
    const { data } = await client.rpc('current_user_has_permission', {
      p_org_id: orgA,
      p_permission_code: 'audit.view',
    })
    expect(data).toBe(false)
  })

  it('un override expire n\'a plus d\'effet', async () => {
    const admin = adminClient()
    const { data: permission } = await admin
      .from('permissions')
      .select('id')
      .eq('code', 'asset.view')
      .single()

    // La contrainte CHECK (expires_at is null or expires_at > created_at)
    // interdit de creer un override "deja expire" — on cree une expiration
    // proche dans le futur puis on attend qu'elle passe, pour tester le
    // comportement reel du "point dans le temps" plutot qu'une donnee
    // invalide. Trouvaille reelle contre le cloud : expires_at est calcule
    // cote client AVANT l'appel reseau, et la latence de ce sandbox
    // (TLS/egress) est fortement variable — observee jusqu'a ~3.7s sur un
    // seul insert — donc toute marge fixe choisie a l'avance peut se faire
    // rattraper par created_at (echec de la contrainte CHECK cote serveur).
    // Marge genereuse (10s, tolere une latence bien superieure a tout ce
    // qui a ete observe) + attente RECALCULEE apres coup a partir de
    // expires_at reellement enregistre (pas d'un total fixe devine a
    // l'avance) : correct quelle qu'ait ete la latence de cet insert
    // precis. Sans lien avec RLS — cet insert utilise le client
    // service_role, qui ignore RLS.
    const EXPIRY_MARGIN_MS = 10_000
    const WAIT_BUFFER_MS = 1500
    const { data: override, error: insertError } = await admin
      .from('user_permission_overrides')
      .insert({
        user_id: employeUserId,
        organization_id: orgA,
        permission_id: (permission as { id: string }).id,
        effect: 'grant',
        reason: 'Test integration — override bientot expire',
        granted_by: employeUserId,
        expires_at: new Date(Date.now() + EXPIRY_MARGIN_MS).toISOString(),
      })
      .select('id, expires_at')
      .single()
    expect(insertError, `insertion de l'override : ${JSON.stringify(insertError)}`).toBeNull()
    overrideIds.push((override as { id: string }).id)

    const { client } = await signInAs('employe.demo@medfinder.test')

    const beforeExpiry = await client.rpc('current_user_has_permission', {
      p_org_id: orgA,
      p_permission_code: 'asset.view',
    })
    expect(beforeExpiry.data, 'accorde tant que non expire').toBe(true)

    const remainingMs = new Date((override as { expires_at: string }).expires_at).getTime() - Date.now()
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, remainingMs) + WAIT_BUFFER_MS))

    const afterExpiry = await client.rpc('current_user_has_permission', {
      p_org_id: orgA,
      p_permission_code: 'asset.view',
    })
    expect(afterExpiry.data, 'un override expire ne doit plus accorder la permission').toBe(false)
  })
})
