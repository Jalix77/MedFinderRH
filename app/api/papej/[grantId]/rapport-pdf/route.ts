import { createClient } from '@/lib/supabase/server'
import { buildPapejReportPdf, type PapejReportData } from '@/lib/pdf/papej-report'

/**
 * Export PDF du rapport PAPEJ — reutilise EXACTEMENT le meme RPC
 * (generate_papej_report) que l'ecran et l'export CSV, avec les memes
 * parametres de periode : l'export respecte donc par construction les
 * memes filtres et donnees que ce qui est affiche (§ exigence explicite).
 *
 * Autorisation : entierement portee par la RPC elle-meme
 * (is_super_admin OR has_permission(..., 'papej.report')), qui renvoie
 * {success:false, error:'not_authorized'} — jamais une exception — pour
 * ne pas casser sa propre trace d'audit "denied". Cette route traduit ce
 * refus en 403 HTTP explicite. L'isolation multi-organisation est geree
 * en amont par le SELECT sur `grants` a l'interieur de la RPC (RLS
 * implicite via has_permission qui verifie l'appartenance active a
 * l'organisation du financement) : un acteur d'une autre organisation
 * qui devine un grantId etranger recoit le meme refus not_authorized,
 * jamais les donnees.
 */
export async function GET(request: Request, { params }: { params: Promise<{ grantId: string }> }) {
  const { grantId } = await params
  const { searchParams } = new URL(request.url)
  const periodStart = searchParams.get('period_start')
  const periodEnd = searchParams.get('period_end')

  if (!periodStart || !periodEnd) {
    return new Response('Parametres period_start et period_end requis.', { status: 400 })
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
    return new Response('Format de date invalide (attendu AAAA-MM-JJ).', { status: 400 })
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('generate_papej_report', {
    p_grant_id: grantId,
    p_period_start: periodStart,
    p_period_end: periodEnd,
  })

  if (error) {
    // Ressource introuvable (grant_id invalide) ou erreur de donnees —
    // jamais de detail d'erreur brut renvoye au client.
    return new Response('Financement introuvable ou parametres invalides.', { status: 404 })
  }

  const result = data as { success: boolean; error?: string; report?: PapejReportData }
  if (!result.success) {
    return new Response('Vous n\'avez pas la permission necessaire pour generer ce rapport.', { status: 403 })
  }

  const pdfBytes = await buildPapejReportPdf(result.report!, new Date())
  const safeName = (result.report!.grant_name || 'papej').replace(/[^a-zA-Z0-9._-]/g, '_')

  return new Response(new Uint8Array(pdfBytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="rapport-papej-${safeName}-${periodStart}-${periodEnd}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
