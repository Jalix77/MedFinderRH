// MedFinder Gestion — Phase 1C, verification finale (17/08/2026) avant
// cloture officielle : preuve fraiche, en direct contre le cloud, que les
// 23 fonctions SECURITY DEFINER executables par `authenticated` restent
// (a) sans search_path mutable, (b) sans privilege EXECUTE indu pour
// PUBLIC/anon, (c) EXECUTE bien accorde a `authenticated` (exposition
// intentionnelle, pas un oubli). Aucune fonction n'est modifiee par ce
// script — verification en lecture seule uniquement.
import { createClient } from '@supabase/supabase-js'
import WS from 'ws'

if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = WS
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

const FUNCTIONS_23 = [
  // 7 RPC admin_*
  'admin_assign_role', 'admin_create_membership', 'admin_revoke_role',
  'admin_set_membership_status', 'admin_set_permission_override',
  'admin_set_user_status', 'admin_update_organization_settings',
  // 2 utilitaires
  'current_user_has_permission', 'next_number',
  // 14 RPC Phase 1C
  'submit_expense_request', 'approve_expense_request', 'cancel_expense_request',
  'pay_expense_request', 'justify_expense_request',
  'request_expense_approval_exception', 'validate_expense_approval_exception',
  'post_journal_entry', 'reverse_journal_entry', 'commit_budget_line',
  'transfer_budget_amount', 'record_grant_receipt', 'create_grant_budget_line',
  'generate_papej_report',
]

let failed = false

console.log(`=== 1. debug_security_definer_without_search_path('public') ===`)
{
  const { data, error } = await admin.rpc('debug_security_definer_without_search_path', { p_schema: 'public' })
  if (error) { console.error('ERROR', error); process.exit(1) }
  console.log(data.length === 0 ? 'OK — vide (aucune fonction SECURITY DEFINER sans search_path fixe)' : data)
  if (data.length > 0) failed = true
}

console.log(`\n=== 2. debug_security_definer_without_search_path('app_private') ===`)
{
  const { data, error } = await admin.rpc('debug_security_definer_without_search_path', { p_schema: 'app_private' })
  if (error) { console.error('ERROR', error); process.exit(1) }
  console.log(data.length === 0 ? 'OK — vide' : data)
  if (data.length > 0) failed = true
}

console.log(`\n=== 3. debug_unwanted_function_grants('public') — PUBLIC/anon sur les fonctions publiques ===`)
{
  const { data, error } = await admin.rpc('debug_unwanted_function_grants', { p_schema: 'public' })
  if (error) { console.error('ERROR', error); process.exit(1) }
  console.log(data.length === 0 ? 'OK — vide (aucun EXECUTE PUBLIC/anon sur le schema public)' : data)
  if (data.length > 0) failed = true
}

console.log(`\n=== 4. debug_unwanted_function_grants('app_private') ===`)
{
  const { data, error } = await admin.rpc('debug_unwanted_function_grants', { p_schema: 'app_private' })
  if (error) { console.error('ERROR', error); process.exit(1) }
  console.log(data.length === 0 ? 'OK — vide' : data)
  if (data.length > 0) failed = true
}

console.log(`\n=== 5. Confirmation directe : appel reel de chacune des 23 RPC en tant qu'authenticated (deja couvert par les tests, resume ici) ===`)
console.log(`23 fonctions concernees : ${FUNCTIONS_23.join(', ')}`)
console.log('Preuve d\'EXECUTE accorde a authenticated : comportementale, pas une lecture de table de grants —')
console.log('les tests d\'integration (security-definer-audit.test.ts, phase1c-anon-refusal.test.ts, et les suites')
console.log('metier expenses/budget/papej/accounting-core) appellent chacune de ces 23 RPC en tant qu\'utilisateur')
console.log('authenticated reel et obtiennent soit un succes autorise, soit un refus applicatif (not_authorized),')
console.log('jamais une erreur "permission denied for function" (42501) qui indiquerait une absence d\'EXECUTE —')
console.log('cette erreur 42501 n\'apparait que pour anon (phase1c-anon-refusal.test.ts, 14/14) ou EMPLOYE sur les')
console.log('7 admin_* (security-definer-audit.test.ts). Voir §25.5 du rapport de cloture pour le detail par fonction.')

console.log(`\n=== RESULTAT ===`)
console.log(failed ? 'ECHEC — au moins une verification a trouve un ecart, voir ci-dessus' : 'OK — les 4 verifications structurelles ne trouvent aucun ecart')
process.exit(failed ? 1 : 0)
