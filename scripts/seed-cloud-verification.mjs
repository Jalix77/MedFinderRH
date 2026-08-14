#!/usr/bin/env node
/**
 * Seed de VERIFICATION pour un projet Supabase cloud dedie a l'audit
 * (jamais destine a un projet staging/production reel — voir
 * docs/phase-1a-closing-report.md §Audit point 8). Recree, via l'API
 * (Auth Admin + PostgREST, service_role), l'equivalent de supabase/seed.sql
 * sans dependre de psql/Docker (utile quand la connexion Postgres directe
 * n'est pas disponible depuis l'environnement d'execution).
 *
 * Usage :
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 \
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/seed-cloud-verification.mjs
 *
 * NODE_TLS_REJECT_UNAUTHORIZED=0 n'est necessaire que si l'environnement
 * d'execution est derriere un proxy interceptant TLS dont le certificat
 * n'est pas dans le magasin de confiance de Node (constate sur ce poste
 * Windows) — jamais a utiliser en production.
 */

import { createClient } from '@supabase/supabase-js'

if (typeof globalThis.WebSocket === 'undefined') {
  const { default: WS } = await import('ws')
  globalThis.WebSocket = WS
}

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceRoleKey) {
  console.error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY doivent etre definis.')
  process.exit(1)
}

const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
const DEMO_PASSWORD = 'DemoPass#2026'

const USERS = [
  { email: 'super.demo@medfinder.test', name: 'Demo Super Admin', role: 'SUPER_ADMIN', org: 'A', status: 'active' },
  { email: 'dg.demo@medfinder.test', name: 'Demo Directeur General', role: 'DIRECTEUR_GENERAL', org: 'A', status: 'active' },
  { email: 'dt.demo@medfinder.test', name: 'Demo Directeur Tech', role: 'DIRECTEUR_TECHNIQUE', org: 'A', status: 'active' },
  { email: 'comptable.demo@medfinder.test', name: 'Demo Comptable', role: 'COMPTABLE', org: 'A', status: 'active' },
  { email: 'rh.demo@medfinder.test', name: 'Demo RH', role: 'RH', org: 'A', status: 'active' },
  { email: 'manager.demo@medfinder.test', name: 'Demo Manager', role: 'MANAGER', org: 'A', status: 'active' },
  { email: 'agent.demo@medfinder.test', name: 'Demo Agent Terrain', role: 'AGENT_TERRAIN', org: 'A', status: 'active' },
  { email: 'support.demo@medfinder.test', name: 'Demo Support', role: 'SUPPORT', org: 'A', status: 'active' },
  { email: 'employe.demo@medfinder.test', name: 'Demo Employe', role: 'EMPLOYE', org: 'A', status: 'active' },
  { email: 'suspendu.demo@medfinder.test', name: 'Demo Suspendu', role: 'EMPLOYE', org: 'A', status: 'suspended' },
  { email: 'orgb.demo@medfinder.test', name: 'Demo Org B DG', role: 'DIRECTEUR_GENERAL', org: 'B', status: 'active' },
]

async function ensureOrg(name) {
  const { data: existing } = await admin.from('organizations').select('id').eq('name', name).maybeSingle()
  if (existing) return existing.id
  const { data, error } = await admin.from('organizations').insert({ name }).select('id').single()
  if (error) throw error
  console.log(`Organisation creee : ${name} (${data.id})`)
  return data.id
}

async function ensureUser(email, name) {
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: name },
  })
  if (!error) return created.user.id
  if (!String(error.message || '').toLowerCase().includes('already')) throw error
  const { data: list, error: listErr } = await admin.auth.admin.listUsers()
  if (listErr) throw listErr
  const existing = list.users.find((u) => u.email === email)
  if (!existing) throw new Error(`Utilisateur ${email} introuvable apres conflit.`)
  return existing.id
}

async function main() {
  const orgA = await ensureOrg('MedFinder Demo — Organisation A')
  const orgB = await ensureOrg('MedFinder Demo — Organisation B')

  const { data: roles, error: rolesErr } = await admin.from('roles').select('id, code').is('organization_id', null)
  if (rolesErr) throw rolesErr
  const roleIdByCode = Object.fromEntries(roles.map((r) => [r.code, r.id]))

  for (const u of USERS) {
    const userId = await ensureUser(u.email, u.name)
    const orgId = u.org === 'A' ? orgA : orgB

    const { data: membership, error: memErr } = await admin
      .from('memberships')
      .upsert({ user_id: userId, organization_id: orgId, status: u.status }, { onConflict: 'user_id,organization_id' })
      .select('id')
      .single()
    if (memErr) throw memErr

    const { error: roleErr } = await admin
      .from('membership_roles')
      .upsert({ membership_id: membership.id, role_id: roleIdByCode[u.role] }, { onConflict: 'membership_id,role_id' })
    if (roleErr) throw roleErr

    console.log(`OK ${u.email} -> ${u.role} (${u.org}, ${u.status})`)
  }

  console.log('\nSeed de verification cloud termine.')
}

main().catch((err) => {
  console.error('Echec du seed cloud :', err.message || err)
  process.exit(1)
})
