import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Options partagees par les ecrans de creation et d'edition d'un document.
 *
 * Toutes les lectures passent par le client SERVEUR de l'utilisateur :
 * la RLS filtre donc l'organisation, et aucun filtre organisationnel
 * n'est reimplemente ici (ce serait une seconde autorite).
 */
export async function loadInvoiceFormOptions(supabase: SupabaseClient) {
  const [{ data: customers }, { data: accounts }, { data: taxes }, { data: costCenters }, { data: invoices }] =
    await Promise.all([
      supabase
        .from('third_parties')
        .select('id, third_party_code, legal_name')
        .eq('is_customer', true)
        .eq('is_active', true)
        .order('legal_name'),
      supabase
        .from('chart_of_accounts')
        .select('id, code, label')
        .eq('type', 'revenue')
        .eq('is_active', true)
        .order('code'),
      supabase
        .from('tax_rates')
        .select('id, code, label, rate_percent')
        .eq('is_active', true)
        .order('code'),
      supabase.from('cost_centers').select('id, code, name').order('code'),
      supabase
        .from('invoices')
        .select('id, document_number, total, currency')
        .eq('document_type', 'INVOICE')
        .in('status', ['issued', 'partially_paid', 'paid'])
        .order('document_date', { ascending: false })
        .limit(200),
    ])

  return {
    customers: (customers ?? []).map((c) => ({
      id: c.id as string,
      label: `${c.third_party_code} — ${c.legal_name}`,
    })),
    revenueAccounts: (accounts ?? []).map((a) => ({
      id: a.id as string,
      label: `${a.code} — ${a.label}`,
    })),
    taxRates: (taxes ?? []).map((t) => ({
      id: t.id as string,
      label: `${t.code} (${t.rate_percent}%)`,
      rate_percent: Number(t.rate_percent),
    })),
    costCenters: (costCenters ?? []).map((c) => ({
      id: c.id as string,
      label: `${c.code} — ${c.name}`,
    })),
    issuedInvoices: (invoices ?? []).map((i) => ({
      id: i.id as string,
      label: `${i.document_number} (${i.total} ${i.currency})`,
    })),
  }
}
