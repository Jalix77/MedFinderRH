import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Mecanisme partage (Vitest ET Playwright — ce fichier n'importe ni l'un
 * ni l'autre, uniquement @supabase/supabase-js, donc chargeable depuis les
 * deux runners sans dupliquer la logique, contrairement a l'ancien choix
 * de dupliquer tests/e2e/fixtures.ts) pour rendre les suites
 * d'integration/E2E hermetiques :
 *
 * 1. TEST_FIXTURE_MARKER / tag() : toute donnee creee par un test doit
 *    porter cette marque dans son champ texte identifiant (nom,
 *    categorie, libelle, beneficiaire...) — un moyen NON AMBIGU de
 *    distinguer une ligne creee par les tests d'une donnee reelle, y
 *    compris a l'oeil nu dans le dashboard Supabase. Jamais utilise seul
 *    pour decider quoi supprimer en temps reel (voir FixtureRegistry) —
 *    sert de filet de securite et de moyen de reperer, avec certitude,
 *    les fixtures deja accumulees avant l'adoption de ce mecanisme
 *    (scripts/cleanup-legacy-test-fixtures.mjs).
 *
 * 2. FixtureRegistry : suivi PRECIS (table, id) de chaque ligne creee par
 *    un test, dans l'ordre de creation. Le nettoyage supprime dans
 *    l'ordre STRICTEMENT INVERSE de la creation — correct vis-a-vis des
 *    contraintes de cle etrangere par construction (un enfant est
 *    toujours cree apres son parent, donc toujours supprime avant lui),
 *    sans avoir a maintenir une table d'ordonnancement figee par schema.
 *    `track()` doit etre appele IMMEDIATEMENT apres chaque insertion
 *    reussie, avant toute assertion susceptible d'echouer — ainsi, meme
 *    si le test s'arrete en erreur au milieu, tout ce qui a reellement
 *    ete cree jusque-la reste enregistre et sera nettoye par
 *    `cleanup()` (appele depuis un `afterAll`/`afterEach`/`finally`,
 *    jamais conditionnellement au succes du test).
 *
 * Jamais de suppression par anciennete ni par heuristique large (ex.
 * "tout ce qui contient E2E") pour le nettoyage EN DIRECT d'un test —
 * uniquement les identifiants exacts realellement crees par CE test.
 */
// ASCII strict (pas de crochets Unicode ⟦⟧) : trouvaille reelle — un nom
// tague finit parfois affiche dans un PDF genere par pdf-lib
// (lib/pdf/papej-report.ts, rapport PAPEJ), dont l'encodage WinAnsi ne
// couvre pas ⟦/⟧ (U+27E6/27E7) — faisait planter la generation (500) du
// tout premier test qui exerce reellement le contenu du PDF avec un
// financement tague. Un marqueur ASCII est representable partout
// (PDF/CSV/HTML/dashboard) sans exception.
export const TEST_FIXTURE_MARKER = '[TEST-FIXTURE]'

/** Prefixe un libelle avec la marque de fixture de test — a utiliser sur
 * TOUT champ texte identifiant (name/category/label/payee_name/...) cree
 * par un test. */
export function tag(label: string): string {
  return `${TEST_FIXTURE_MARKER} ${label}`
}

type TrackedRow = { table: string; id: string }

export class FixtureRegistry {
  private rows: TrackedRow[] = []

  /** A appeler immediatement apres chaque insertion reussie. */
  track(table: string, id: string): void {
    this.rows.push({ table, id })
  }

  /** Enregistre plusieurs lignes d'un coup (ex. insertion multiple). */
  trackMany(table: string, ids: string[]): void {
    for (const id of ids) this.track(table, id)
  }

  /**
   * Absorbe le suivi d'un autre registre (ex. composition de plusieurs
   * fixtures independantes en une seule fixture composite) — l'autre
   * registre est vide apres l'appel, pour eviter un double nettoyage.
   */
  merge(other: FixtureRegistry): void {
    this.rows.push(...other.rows)
    other.rows = []
  }

  /**
   * Pour les lignes creees INDIRECTEMENT par une RPC de workflow (ex.
   * transfer_budget_amount cree une ligne budget_transfers,
   * commit_budget_line cree une ligne budget_commitments,
   * approve/pay_expense_request cree journal_entries/cash_movements...)
   * — interroge `table` pour les lignes dont `whereColumn` correspond a
   * un identifiant que CE test a deja lui-meme cree et enregistre
   * (jamais une recherche large : uniquement nos propres ids), et les
   * enregistre a leur tour. A appeler juste apres l'appel RPC qui les a
   * creees, avant toute assertion. Necessaire car certaines FK
   * (budget_transfers.from_line_id/to_line_id,
   * budget_commitments.budget_line_id, ...) sont `on delete restrict` —
   * sans ce suivi, la suppression du parent echouerait.
   */
  async trackDerivedFrom(
    admin: SupabaseClient,
    table: string,
    whereColumn: string,
    matchingIds: string[]
  ): Promise<void> {
    if (matchingIds.length === 0) return
    const { data } = await admin.from(table).select('id').in(whereColumn, matchingIds)
    for (const row of (data as { id: string }[] | null) ?? []) this.track(table, row.id)
  }

  /**
   * Supprime dans l'ordre inverse de creation (dernier cree = premier
   * supprime). Regroupe les identifiants consecutifs d'UNE MEME table en
   * un seul `delete().in('id', ...)` (au lieu d'un aller-retour reseau
   * par ligne — trouvaille reelle : avec des dizaines de lignes suivies,
   * un `.eq()` par ligne depassait le hookTimeout Vitest de 30s sous
   * charge reseau, faisant echouer le afterAll lui-meme) tout en
   * conservant l'ordre inverse EXACT entre tables differentes — deux
   * lignes de la meme table creees a des moments non consecutifs (donc
   * separees par la creation d'une ligne d'une autre table) restent dans
   * des lots distincts, traites chacun a sa place dans l'ordre inverse ;
   * aucune regroupement ne fait jamais passer une suppression avant celle
   * d'une ligne creee apres elle. Erreurs ignorees par lot (best-effort —
   * ex. ligne deja supprimee par une RPC du workflow teste, ou blocage
   * FK d'immutabilite comptable documente dans les tests concernes) :
   * jamais un test qui echoue a cause de son propre nettoyage.
   */
  async cleanup(admin: SupabaseClient): Promise<void> {
    // Construit les lots (table, [ids]) en parcourant a l'envers,
    // fusionnant uniquement les entrees CONSECUTIVES de la meme table.
    const batches: { table: string; ids: string[] }[] = []
    for (let i = this.rows.length - 1; i >= 0; i--) {
      const { table, id } = this.rows[i]
      const last = batches[batches.length - 1]
      if (last && last.table === table) {
        last.ids.push(id)
      } else {
        batches.push({ table, ids: [id] })
      }
    }

    for (const { table, ids } of batches) {
      try {
        await admin.from(table).delete().in('id', ids)
      } catch {
        // best-effort — voir commentaire ci-dessus
      }
    }
    this.rows = []
  }
}
