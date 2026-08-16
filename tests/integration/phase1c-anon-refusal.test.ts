import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'

if (typeof globalThis.WebSocket === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  globalThis.WebSocket = require('ws')
}

/**
 * Hardening demande suite aux exports Security Advisor reels
 * (authenticated_security_definer_function_executable, 14 RPC Phase 1C) :
 * hypothese non couverte par un test explicite jusqu'ici — le meme defaut
 * trouve en Phase 1A (le template cloud Supabase peut accorder `anon` un
 * privilege separe du pseudo-role PUBLIC, non couvert par
 * `revoke all ... from public` seul, voir 20260813100016) pourrait en
 * theorie affecter aussi les 14 RPC publiques Phase 1C. Verifie
 * explicitement ici plutot que suppose — la protection reelle vient de
 * `alter default privileges in schema public revoke execute on functions
 * from public, anon` (meme migration), applicable a toute fonction future.
 */
describe('Phase 1C — anon ne peut executer aucune des 14 RPC publiques', () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const anonClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })

  const rpcs: { name: string; args: Record<string, unknown> }[] = [
    { name: 'submit_expense_request', args: { p_expense_id: '00000000-0000-0000-0000-000000000000' } },
    { name: 'approve_expense_request', args: { p_expense_id: '00000000-0000-0000-0000-000000000000', p_decision: 'approved' } },
    { name: 'cancel_expense_request', args: { p_expense_id: '00000000-0000-0000-0000-000000000000', p_reason: 'x' } },
    {
      name: 'pay_expense_request',
      args: {
        p_expense_id: '00000000-0000-0000-0000-000000000000',
        p_treasury_account_type: 'cash',
        p_treasury_account_id: '00000000-0000-0000-0000-000000000000',
      },
    },
    { name: 'justify_expense_request', args: { p_expense_id: '00000000-0000-0000-0000-000000000000' } },
    {
      name: 'request_expense_approval_exception',
      args: { p_expense_id: '00000000-0000-0000-0000-000000000000', p_justification: 'x' },
    },
    {
      name: 'validate_expense_approval_exception',
      args: { p_expense_id: '00000000-0000-0000-0000-000000000000', p_result: 'approved' },
    },
    { name: 'post_journal_entry', args: { p_entry_id: '00000000-0000-0000-0000-000000000000' } },
    { name: 'reverse_journal_entry', args: { p_entry_id: '00000000-0000-0000-0000-000000000000', p_reason: 'x' } },
    {
      name: 'commit_budget_line',
      args: {
        p_budget_line_id: '00000000-0000-0000-0000-000000000000',
        p_reference_type: 'expense_request',
        p_reference_id: '00000000-0000-0000-0000-000000000000',
        p_amount: 1,
      },
    },
    {
      name: 'transfer_budget_amount',
      args: {
        p_from_line_id: '00000000-0000-0000-0000-000000000000',
        p_to_line_id: '00000000-0000-0000-0000-000000000001',
        p_amount: 1,
        p_reason: 'x',
      },
    },
    {
      name: 'record_grant_receipt',
      args: {
        p_grant_id: '00000000-0000-0000-0000-000000000000',
        p_amount: 1,
        p_received_date: '2026-01-01',
        p_treasury_account_type: 'cash',
        p_treasury_account_id: '00000000-0000-0000-0000-000000000000',
      },
    },
    {
      name: 'create_grant_budget_line',
      args: { p_grant_id: '00000000-0000-0000-0000-000000000000', p_category: 'x', p_planned_amount: 1 },
    },
    {
      name: 'generate_papej_report',
      args: { p_grant_id: '00000000-0000-0000-0000-000000000000', p_period_start: '2026-01-01', p_period_end: '2026-12-31' },
    },
  ]

  it.each(rpcs)('anon ne peut pas executer $name (permission denied, jamais une execution)', async ({ name, args }) => {
    const { error } = await anonClient.rpc(name, args)
    expect(error, `${name} devrait etre refuse a anon`).not.toBeNull()
    // 42501 = permission denied (privilege EXECUTE absent) — jamais un
    // succes ni une erreur de donnees (qui prouverait que l'appel a ete
    // execute avec les privileges du proprietaire avant d'echouer).
    expect(error?.code).toBe('42501')
  })
})
