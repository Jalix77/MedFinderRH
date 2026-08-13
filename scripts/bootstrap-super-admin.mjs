#!/usr/bin/env node
/**
 * MedFinder Gestion — Bootstrap du premier SUPER_ADMIN.
 *
 * Procedure sure (voir docs/security.md §1) :
 *   - Ne s'execute JAMAIS automatiquement (pas de hook, pas de CI, pas de
 *     seed applique en production).
 *   - Utilise UNIQUEMENT la cle service_role, lue depuis l'environnement
 *     (jamais hardcodee, jamais loggee).
 *   - Cree (ou reutilise) l'organisation "MedFinder Haiti", cree le compte
 *     Supabase Auth si besoin, force le changement de mot de passe a la
 *     premiere connexion, et assigne le role SUPER_ADMIN.
 *   - A executer une seule fois par un operateur humain, en local face a la
 *     base cible (dev/staging/prod), jamais depuis une route applicative.
 *
 * Usage :
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/bootstrap-super-admin.mjs --email dg@medfinderhaiti.com --name "Jean Alix Pierre"
 *
 * Le mot de passe temporaire est genere aleatoirement et affiche UNE SEULE
 * fois a l'ecran (jamais ecrit dans un fichier ni loggue ailleurs) — a
 * transmettre hors bande et a changer immediatement a la premiere connexion.
 */

import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'

// @supabase/supabase-js construit un client Realtime des l'appel a
// createClient(), meme s'il n'est jamais utilise, et requiert un WebSocket
// natif (disponible nativement a partir de Node 22 seulement). Sur Node 20
// (LTS encore largement deployee), on fournit un polyfill — voir la note de
// risque technique correspondante dans le rapport de cloture Phase 1A.
if (typeof globalThis.WebSocket === 'undefined') {
  const { default: WebSocket } = await import('ws')
  globalThis.WebSocket = WebSocket
}

function parseArgs(argv) {
  const args = { email: null, name: null, org: 'MedFinder Haiti' }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--email') args.email = argv[++i]
    else if (argv[i] === '--name') args.name = argv[++i]
    else if (argv[i] === '--org') args.org = argv[++i]
  }
  return args
}

function generateTempPassword() {
  // 20 caracteres, alphabet large, jamais persiste.
  return crypto.randomBytes(20).toString('base64url').slice(0, 20)
}

async function main() {
  const { email, name, org } = parseArgs(process.argv.slice(2))
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!email || !name) {
    console.error('Usage: node scripts/bootstrap-super-admin.mjs --email <email> --name "<nom complet>" [--org "<organisation>"]')
    process.exit(1)
  }
  if (!url || !serviceRoleKey) {
    console.error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY doivent etre definis dans l\'environnement (jamais en argument de ligne de commande, jamais committes).')
    process.exit(1)
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // 1. Organisation (idempotent).
  let { data: orgRow, error: orgSelectErr } = await admin
    .from('organizations')
    .select('id')
    .eq('name', org)
    .maybeSingle()
  if (orgSelectErr) throw orgSelectErr

  if (!orgRow) {
    const { data: created, error: orgInsertErr } = await admin
      .from('organizations')
      .insert({ name: org })
      .select('id')
      .single()
    if (orgInsertErr) throw orgInsertErr
    orgRow = created
    console.log(`Organisation "${org}" creee (id=${orgRow.id}).`)
  } else {
    console.log(`Organisation "${org}" existante reutilisee (id=${orgRow.id}).`)
  }

  // 2. Compte Supabase Auth (idempotent : reutilise si l'email existe deja).
  const tempPassword = generateTempPassword()
  let userId = null
  let createdNewAuthUser = false

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: name },
  })

  if (createErr) {
    if (String(createErr.message || '').toLowerCase().includes('already')) {
      const { data: list, error: listErr } = await admin.auth.admin.listUsers()
      if (listErr) throw listErr
      const existing = list.users.find((u) => u.email === email)
      if (!existing) throw new Error(`Utilisateur ${email} introuvable apres conflit de creation.`)
      userId = existing.id
      console.log(`Compte Supabase Auth existant reutilise pour ${email} (mot de passe NON modifie).`)
    } else {
      throw createErr
    }
  } else {
    userId = created.user.id
    createdNewAuthUser = true
  }

  // 3. Membership + role SUPER_ADMIN (idempotent).
  const { data: role, error: roleErr } = await admin
    .from('roles')
    .select('id')
    .eq('code', 'SUPER_ADMIN')
    .is('organization_id', null)
    .single()
  if (roleErr) throw roleErr

  const { data: membership, error: membershipErr } = await admin
    .from('memberships')
    .upsert(
      { user_id: userId, organization_id: orgRow.id, status: 'active' },
      { onConflict: 'user_id,organization_id' }
    )
    .select('id')
    .single()
  if (membershipErr) throw membershipErr

  const { error: roleLinkErr } = await admin
    .from('membership_roles')
    .upsert(
      { membership_id: membership.id, role_id: role.id },
      { onConflict: 'membership_id,role_id' }
    )
  if (roleLinkErr) throw roleLinkErr

  console.log('')
  console.log('=== Bootstrap SUPER_ADMIN termine ===')
  console.log(`Organisation : ${org} (${orgRow.id})`)
  console.log(`Utilisateur  : ${email} (${userId})`)
  console.log(`Role         : SUPER_ADMIN`)
  if (createdNewAuthUser) {
    console.log('')
    console.log(`Mot de passe temporaire (a transmettre hors bande, PAS par ce terminal partage) :`)
    console.log(`  ${tempPassword}`)
    console.log('')
    console.log('IMPORTANT : ce mot de passe ne sera plus jamais affiche. Le compte doit le')
    console.log('changer des la premiere connexion, puis activer le MFA (obligatoire pour')
    console.log('SUPER_ADMIN — voir docs/security.md §1 et §D2).')
  }
}

main().catch((err) => {
  console.error('Echec du bootstrap :', err.message || err)
  process.exit(1)
})
