#!/usr/bin/env node
/**
 * Extension de seed-cloud-verification.mjs : ajoute des donnees RH
 * (departements, postes, employes, contrats, donnees sensibles) sur le
 * projet Supabase cloud dedie a l'audit, en s'appuyant sur les comptes de
 * demo deja crees. Usage identique (voir seed-cloud-verification.mjs).
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

async function main() {
  const { data: orgA, error: orgErr } = await admin
    .from('organizations')
    .select('id')
    .eq('name', 'MedFinder Demo — Organisation A')
    .single()
  if (orgErr) throw orgErr

  const { data: existingDept } = await admin
    .from('departments')
    .select('id')
    .eq('organization_id', orgA.id)
    .limit(1)
    .maybeSingle()
  if (existingDept) {
    console.log('Donnees RH deja presentes sur ce projet — rien a faire.')
    return
  }

  const { data: dept, error: deptErr } = await admin
    .from('departments')
    .insert({ organization_id: orgA.id, name: 'Direction' })
    .select('id')
    .single()
  if (deptErr) throw deptErr

  const { data: pos, error: posErr } = await admin
    .from('positions')
    .insert({ organization_id: orgA.id, department_id: dept.id, title: 'Fondateur & Directeur General' })
    .select('id')
    .single()
  if (posErr) throw posErr

  const { data: dgUser } = await admin.from('users').select('id').eq('full_name', 'Demo Directeur General').single()
  const { data: rhUser } = await admin.from('users').select('id').eq('full_name', 'Demo RH').single()
  const { data: employeUser } = await admin.from('users').select('id').eq('full_name', 'Demo Employe').single()

  const { data: empDg, error: empErr } = await admin
    .from('employees')
    .insert({
      organization_id: orgA.id,
      matricule: '',
      user_id: dgUser?.id ?? null,
      first_name: 'Demo',
      last_name: 'DG Cloud',
      hire_date: '2026-01-01',
      department_id: dept.id,
      position_id: pos.id,
    })
    .select('id')
    .single()
  if (empErr) throw empErr

  const { data: empEmploye } = await admin
    .from('employees')
    .insert({
      organization_id: orgA.id,
      matricule: '',
      user_id: employeUser?.id ?? null,
      first_name: 'Demo',
      last_name: 'Employe Cloud',
      hire_date: '2026-01-01',
    })
    .select('id')
    .single()

  await admin.from('employee_sensitive_data').insert({
    employee_id: empDg.id,
    organization_id: orgA.id,
    nif: 'NIF-CLOUD-0001',
    cin: 'CIN-CLOUD-0001',
  })

  await admin.from('contracts').insert([
    {
      organization_id: orgA.id,
      employee_id: empDg.id,
      type: 'fondateur',
      start_date: '2026-01-01',
      base_salary: 0,
      currency: 'HTG',
      status: 'active',
    },
    {
      organization_id: orgA.id,
      employee_id: empEmploye.id,
      type: 'CDI',
      start_date: '2026-01-01',
      base_salary: 20000,
      currency: 'HTG',
      status: 'active',
    },
  ])

  void rhUser
  console.log('Seed RH cloud termine : 1 departement, 1 poste, 2 employes, 1 fiche sensible, 2 contrats.')
}

main().catch((err) => {
  console.error('Echec du seed RH cloud :', err.message || err)
  process.exit(1)
})
