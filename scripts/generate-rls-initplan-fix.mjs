// Genere la migration corrective pour les 74 avertissements Performance
// Advisor `auth_rls_initplan` a partir de l'etat REEL des policies en base
// (public.debug_dump_all_policies(), migration 20260816090015) — pas des
// fichiers de migration source, qui pourraient avoir ete modifies entre
// plusieurs fichiers (deja vu avec budget_lines_select : 090001 puis 090010).
//
// Regle mecanique unique : wrap tout appel NU (non deja precede de
// `select`) a auth.uid()/auth.jwt()/auth.role()/auth.email() en
// `(select auth.<fn>())`, partout ou il apparait (y compris dans une
// sous-requete EXISTS) — c'est la forme documentee par Supabase pour
// permettre a Postgres de cacher l'appel en InitPlan au lieu de le
// reevaluer a chaque ligne. Aucune autre transformation : le reste du
// texte qual/with_check est reutilise tel quel, verbatim.
import { writeFileSync } from 'fs'

const policies = JSON.parse(await import('fs').then((fs) => fs.readFileSync('scripts/.policies-dump.json', 'utf8')))

const AUTH_FN_RE = /auth\.(uid|jwt|role|email)\s*\(\s*\)/g

function hasBareAuthCall(sql) {
  if (!sql) return false
  let m
  const re = new RegExp(AUTH_FN_RE)
  while ((m = re.exec(sql))) {
    const before = sql.slice(Math.max(0, m.index - 40), m.index).trimEnd()
    if (!/select\s*$/i.test(before)) return true
  }
  return false
}

function wrap(sql) {
  if (!sql) return sql
  return sql.replace(AUTH_FN_RE, (full) => `(select ${full})`)
}

const cmdMap = { SELECT: 'select', INSERT: 'insert', UPDATE: 'update', DELETE: 'delete', ALL: 'all' }

function parseRoles(rolesText) {
  // format Postgres : "{authenticated}" ou "{authenticated,service_role}"
  return rolesText.replace(/^{|}$/g, '').split(',').filter(Boolean).join(', ')
}

const affected = policies.filter((p) => hasBareAuthCall(p.qual) || hasBareAuthCall(p.with_check))

let out = `-- MedFinder Gestion — Hardening cloud, avertissements Performance Advisor
-- (auth_rls_initplan, ${affected.length} policies concernees sur 79 au total en
-- base — reconciliation dans docs/phase-1c-closing-report.md).
--
-- GENERE MECANIQUEMENT depuis l'etat REEL des policies
-- (public.debug_dump_all_policies(), migration 20260816090015), jamais
-- depuis une relecture des fichiers de migration source. Transformation
-- UNIQUE et IDENTIQUE pour toutes les policies : chaque appel nu
-- auth.uid()/auth.jwt()/auth.role()/auth.email() devient
-- (select auth.<fn>()) — la forme documentee par Supabase pour que
-- Postgres l'evalue une seule fois par requete (InitPlan) au lieu d'une
-- fois par ligne. AUCUNE autre modification : conditions, permissions,
-- perimetre d'acces et roles cibles restent identiques a l'octet pres en
-- dehors de cet enrobage — jamais de changement de logique d'autorisation
-- pour faire taire un avertissement de performance.
--
-- Chaque politique est DROP puis CREATE (Postgres ne supporte pas
-- CREATE OR REPLACE POLICY) avec le meme nom, la meme table, la meme
-- portee (permissive/restrictive), la meme commande (select/insert/
-- update/delete) et les memes roles cibles que la version actuelle.

`

for (const p of affected) {
  const cmd = cmdMap[p.cmd]
  const roles = parseRoles(p.roles)
  const permissiveClause = p.permissive === 'PERMISSIVE' ? 'as permissive' : 'as restrictive'
  const newQual = wrap(p.qual)
  const newCheck = wrap(p.with_check)

  out += `drop policy if exists ${p.policyname} on public.${p.tablename};\n`
  out += `create policy ${p.policyname} on public.${p.tablename}\n`
  out += `  ${permissiveClause}\n`
  out += `  for ${cmd}\n`
  out += `  to ${roles}\n`
  if (newQual !== null && newQual !== undefined) {
    out += `  using (\n    ${newQual}\n  )\n`
  }
  if (newCheck !== null && newCheck !== undefined) {
    out += `  with check (\n    ${newCheck}\n  )\n`
  }
  out = out.trimEnd() + ';\n\n'
}

writeFileSync('supabase/migrations/20260816090016_fix_auth_rls_initplan.sql', out)
console.log(`Generated migration with ${affected.length} policies rewritten.`)
console.log('Preview (first 3000 chars):')
console.log(out.slice(0, 3000))
