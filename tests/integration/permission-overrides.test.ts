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

  // --- Ancien test "un override expire n'a plus d'effet" : REMPLACE -------
  // Trouvaille reelle (retour de Jean Alix Pierre, cloture Phase 2B) :
  // l'ancienne version calculait expires_at cote client (Date.now() +
  // marge fixe de 10s) puis ATTENDAIT reellement que ce delai s'ecoule
  // avant de re-verifier — un scenario a la fois "avant expiration" et
  // "apres expiration" dans le MEME test, chacun sensible a la latence
  // reseau du seul insert+signIn qui le precede. Repro directe (script
  // isole, hors suite) : un insert isole a mesure ~9,86s dans cet
  // environnement — devorant a lui seul la quasi-totalite de la marge de
  // 10s et faisant echouer l'assertion "avant expiration" (accorde tant
  // que non expire) meme si la logique RBAC est correcte.
  //
  // Correction : deux tests distincts, chacun DETERMINISTE, aucune
  // attente de temps reel. La contrainte CHECK de la table est purement
  // relative entre ses deux propres colonnes — jamais une comparaison a
  // l'horloge courante (`expires_at is null or expires_at > created_at`,
  // voir supabase/migrations/20260813100004_roles_permissions_rbac.sql
  // ligne 133) — donc un override peut etre cree DEJA expire en reculant
  // created_at ET expires_at tous deux dans le passe (aucun trigger
  // BEFORE ne force created_at a `now()` reel ; seul un trigger AFTER
  // d'audit existe, cf. 20260813100006_audit_triggers.sql). Aucune regle
  // metier RBAC n'est modifiee ici — uniquement la strategie de creation
  // de donnees de test.

  it('un override GRANT non expire (expiration lointaine) produit l\'effet attendu — aucune dependance au timing', async () => {
    const admin = adminClient()
    const { data: permission } = await admin
      .from('permissions')
      .select('id')
      .eq('code', 'asset.view')
      .single()

    // Expiration a 24h : par construction, jamais rattrapable par la
    // duree du test, quelle que soit la latence observee.
    const { data: override, error } = await admin
      .from('user_permission_overrides')
      .insert({
        user_id: employeUserId,
        organization_id: orgA,
        permission_id: (permission as { id: string }).id,
        effect: 'grant',
        reason: 'Test integration — override actif (expiration lointaine)',
        granted_by: employeUserId,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    overrideIds.push((override as { id: string }).id)

    const { client } = await signInAs('employe.demo@medfinder.test')
    const { data } = await client.rpc('current_user_has_permission', {
      p_org_id: orgA,
      p_permission_code: 'asset.view',
    })
    expect(data, 'accorde tant que non expire').toBe(true)
  })

  it('un override deja expire (horodatage recule cote serveur, deterministe) n\'a plus d\'effet', async () => {
    const admin = adminClient()
    // Code de permission DISTINCT du test precedent ('asset.view') —
    // trouvaille reelle en ecrivant ce fichier : le nettoyage de ce
    // describe se fait uniquement en afterAll (efficacite reseau, pas par
    // test), donc l'override "expiration lointaine" du test precedent
    // reste actif en base pendant celui-ci ; reutiliser le meme code de
    // permission aurait fait passer ce test pour une mauvaise raison (le
    // grant TOUJOURS actif du test precedent, jamais celui, expire, cree
    // ici). Meme convention que les 3 tests plus haut dans ce fichier
    // (employee.create/leave.request/audit.view), chacun deja sur un code
    // distinct pour la meme raison.
    const { data: permission } = await admin
      .from('permissions')
      .select('id')
      .eq('code', 'asset.manage')
      .single()

    // Ne "vient" jamais a expirer pendant le test : nait deja expire.
    // created_at recule d'1h, expires_at recule de 30min — satisfait la
    // contrainte CHECK (expires_at > created_at) tout en etant deja
    // depasse par rapport a l'horloge reelle au moment de l'insertion.
    const now = Date.now()
    const { data: override, error } = await admin
      .from('user_permission_overrides')
      .insert({
        user_id: employeUserId,
        organization_id: orgA,
        permission_id: (permission as { id: string }).id,
        effect: 'grant',
        reason: 'Test integration — override deja expire (deterministe)',
        granted_by: employeUserId,
        created_at: new Date(now - 60 * 60 * 1000).toISOString(),
        expires_at: new Date(now - 30 * 60 * 1000).toISOString(),
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    overrideIds.push((override as { id: string }).id)

    const { client } = await signInAs('employe.demo@medfinder.test')
    const { data } = await client.rpc('current_user_has_permission', {
      p_org_id: orgA,
      p_permission_code: 'asset.manage',
    })
    expect(data, 'un override expire ne doit plus accorder la permission').toBe(false)
  })
})
