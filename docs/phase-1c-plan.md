# Phase 1C — Plan corrigé (référence pour le rapport de clôture)

Statut : approuvé par Jean Alix Pierre le 15/08/2026, sous réserve des 14
corrections architecturales listées ci-dessous — **toutes intégrées dans ce
document avant le premier commit de code**. Ce fichier est la référence
opposable pour comparer le plan à ce qui a réellement été livré dans
`docs/phase-1c-closing-report.md`.

## 1. Périmètre exact

Roadmap Phase 1 items 6 et 7 : workflow dépenses complet, trésorerie
(caisse/banque/mobile money), budget avec engagements transactionnels,
module PAPEJ (financement 850 000 HTG, montant enregistré en base — voir
§9). Socle comptable **minimal** (partie double, période, écritures)
strictement nécessaire pour que le workflow dépense atteigne l'état
`Posted` avec l'invariant `debit = credit` garanti au posting.

**Hors périmètre** (Phase 2/3, non implémenté ici) : rapprochement
bancaire réel (import relevé, UI de lettrage — l'état `Reconciled` du
workflow dépense n'est pas atteint en Phase 1C, le workflow s'arrête à
`Posted`), écritures manuelles, états financiers, module Fournisseurs
(voir §2), clients/facturation, immobilisations, prêt FDI, dons &
subventions génériques, payroll, CRM, Phase 1D, Phase 2.

## 2. Tables — 24 au total (correction : le brouillon initial en annonçait
19 par erreur de comptage, alors que 24 étaient réellement énumérées)

| Groupe | Tables (compte) |
|---|---|
| Comptabilité minimale | `fiscal_years`, `chart_of_accounts`, `accounting_periods`, `journals`, `journal_entries`, `journal_entry_lines` (6) |
| Trésorerie | `cash_accounts`, `bank_accounts`, `mobile_money_accounts`, `cash_movements` (4) |
| Budget | `budgets`, `budget_lines`, `cost_centers`, `budget_commitments`, `budget_transfers` (5) |
| Dépenses | `expense_categories`, `expense_requests`, `expense_approvals`, `expenses`, `expense_attachments` (5) |
| PAPEJ | `grants`, `grant_budget_lines`, `grant_expenses`, `grant_reports` (4) |

**6 + 4 + 5 + 5 + 4 = 24 tables.** Aucune fusion/suppression : le nombre
19 du brouillon initial était une erreur de comptage, pas une intention
de réduire le périmètre.

**Pas de table `suppliers`** : les fournisseurs sont explicitement hors
périmètre (§correction 2). `expense_requests` porte à la place deux
champs transitoires, conçus pour migration ultérieure vers un vrai module
Fournisseurs sans changement de forme de données (juste un remplacement de
`payee_name`/`payee_reference` par une FK `supplier_id`) :
- `payee_name text not null` — nom du bénéficiaire/fournisseur, saisi libre.
- `payee_reference text` — référence externe optionnelle (ex. numéro de
  facture fournisseur), sans validation ni table dédiée.

Aucune permission `supplier.manage` n'est créée dans cette phase.

## 3. Permissions supplémentaires (inchangé vs plan initial, sans
`supplier.manage`)

`expense.create`, `expense.approve`, `expense.pay`, `expense.cancel`,
`expense.view`, `budget.manage`, `budget.view`, `budget.transfer`,
`accounting.post`, `accounting.reverse`, `accounting.close_period`,
`accounting.view`, `treasury.manage`, `treasury.reconcile`, `papej.view`,
`papej.manage`, `papej.report` — **17 permissions** (18 moins
`supplier.manage`), associations `role_permissions` selon
`docs/permissions-matrix.md` (déjà validée en Phase 0).

## 4. Modèle du disponible budgétaire (corrigé — pas de double comptage)

Formule naïve rejetée : `disponible = prévu − engagements − paiements`
(un paiement qui liquide un engagement serait déduit deux fois).

Formule retenue, avec lien explicite engagement ↔ paiement :

```
disponible = planned_amount
            − Σ(budget_commitments.amount WHERE status = 'active')   -- engagé restant (encore ouvert)
            − Σ(expenses.amount WHERE commitment_id IS NOT NULL)      -- payé sur engagement (déjà retiré du "actif" ci-dessus)
            − Σ(expenses.amount WHERE commitment_id IS NULL           -- payé hors engagement, exceptionnel
                AND <rattaché à cette ligne via expense_requests.budget_line_id>)
```

Mécanique : `budget_commitments.status` passe de `active` à `consumed` au
moment du paiement (RPC `pay_expense_request`, voir §5), ce qui retire
son montant de la somme "engagé restant" au même instant où il apparaît
dans "payé sur engagement" via `expenses.commitment_id` — jamais compté
dans les deux sommes simultanément. Un engagement annulé/rejeté passe à
`released` (sort de "engagé restant" sans jamais apparaître en "payé").

Le paiement hors engagement (`expenses.commitment_id is null`) n'est
autorisé que si l'acteur détient `budget.manage` **et** renseigne
`expenses.no_commitment_reason` (not null) — jamais silencieux, jamais
côté client seul (voir §5, RPC dédiée).

Vue `budget_line_balances` : voir §10 (RLS/`security_invoker`).

## 5. Engagements et transitions critiques — RPC transactionnelles
uniquement, jamais d'`INSERT`/`UPDATE` direct côté client

Aucune des tables suivantes n'autorise `INSERT`/`UPDATE` direct par un
rôle `authenticated` via policy RLS : `budget_commitments`,
`journal_entries`, `journal_entry_lines` (après création en `draft` — les
lignes restent modifiables tant que l'entrée est `draft`, via policy
dédiée), `expense_requests.status`, `expenses`. Toute mutation transite
par une fonction `app_private.*` `security definer` qui, dans une seule
transaction :
1. vérifie `auth.uid()` et l'appartenance active à l'organisation ;
2. vérifie la permission requise (`has_permission`) ;
3. verrouille la ligne budgétaire concernée (`select ... for update`) ;
4. recalcule le disponible dans la transaction (formule §4) ;
5. refuse si insuffisant (exception Postgres, transaction annulée) ;
6. crée l'engagement / effectue la transition d'état ;
7. journalise (`app_private.write_audit_log`) ;
8. retourne — commit atomique implicite en fin de fonction.

RPC prévues : `app_private.commit_budget_line` (verrouille `budget_lines`
FOR UPDATE — sérialise les engagements concurrents sur la même ligne),
`app_private.release_budget_commitment`, `app_private.pay_expense_request`
(consomme l'engagement ou enregistre un paiement hors engagement
exceptionnel), `app_private.reject_expense_request`,
`app_private.cancel_expense_request`,
`app_private.justify_expense`, `app_private.post_expense` (délègue à
`app_private.post_journal_entry`, §6).

**Test de concurrence obligatoire** : deux engagements simultanés,
chacun admissible séparément mais dépassant ensemble le disponible d'une
même ligne — un seul doit réussir (verrouillage `FOR UPDATE` testé
directement, pas seulement supposé).

## 6. Comptabilité — invariant vérifié au posting, pas ligne par ligne

Pas de trigger imposant `debit = credit` à chaque `INSERT` sur
`journal_entry_lines` (une écriture a plusieurs lignes et est
naturellement déséquilibrée pendant sa construction en `draft`).

- `draft` : lignes modifiables librement (policy RLS dédiée, permission
  `accounting.post` ou `accounting.view`+contexte source selon le module
  appelant — en pratique toujours via RPC interne, jamais un formulaire
  libre en Phase 1C, la saisie manuelle étant hors périmètre §1).
- `app_private.post_journal_entry(p_entry_id)` — RPC transactionnelle,
  vérifie dans l'ordre : période (`accounting_periods.status = 'open'`),
  au moins 2 lignes, `Σdebit > 0`, `Σcredit > 0`, `Σdebit = Σcredit`,
  chaque `account_id` référence un compte `is_active` de la même
  organisation que l'écriture (`chart_of_accounts.organization_id =
  journal_entries.organization_id` sur toutes les lignes). Si tout passe :
  `status = 'posted'`, `posted_by`, `posted_at`.
- Après `posted` : trigger `BEFORE UPDATE OR DELETE` sur
  `journal_entries` et `journal_entry_lines` qui lève une exception si
  `OLD.status = 'posted'` (aucune modification, aucune suppression,
  aucune exception applicative qui contournerait ce trigger).
- Correction uniquement par contre-passation :
  `app_private.reverse_journal_entry(p_entry_id, p_reason)` crée une
  **nouvelle** écriture (`posted` directement, lignes inversées débit/
  crédit copiées) portant `reversed_entry_id` vers l'originale — l'entrée
  d'origine n'est **jamais** modifiée (pas de statut `reversed` posé
  dessus ; la traçabilité passe uniquement par la nouvelle ligne
  `reversed_entry_id`, interrogeable dans les deux sens).

Tests obligatoires : brouillon déséquilibré autorisé ; posting déséquilibré
refusé ; posting équilibré accepté ; modification d'une ligne postée
refusée ; suppression d'une ligne postée refusée ; posting sur période
fermée refusé ; contre-passation laissant l'originale intacte (bit à bit).

## 7. Périodes comptables fermées

`app_private.post_journal_entry` vérifie explicitement
`accounting_periods.status = 'open'` **dans la RPC**, pas seulement via
RLS. Complémentairement, la policy RLS sur `journal_entry_lines`
(modification en `draft`) vérifie aussi l'état de la période source pour
défense en profondeur — mais la garantie finale est portée par la RPC de
posting. Aucune réouverture silencieuse : un passage `closed → open`
existe uniquement comme action explicite (`accounting.close_period`,
DG requise), tracée en audit, hors du chemin normal.

## 8. Séparation des fonctions — modèle formel (pas seulement
`is_exception` + `exception_reason`)

`expense_approvals` (et toute exception SoD ailleurs dans le module)
porte au minimum :

| Colonne | Rôle |
|---|---|
| `sod_rule_violated` | quelle règle a été contournée (`approver_is_requester`, `payer_is_approver`, …) |
| `exception_justification` | texte obligatoire si exception |
| `exception_requested_by` | qui demande l'exception (jamais implicitement l'acteur courant sans le tracer) |
| `exception_validated_by` | qui valide — **doit être DG**, vérifié par la RPC, et **doit différer de `exception_requested_by`** |
| `exception_validated_at` | horodatage de la validation |
| `exception_result` | `approved`/`refused` |

La RPC qui traite une exception refuse explicitement si
`exception_requested_by = exception_validated_by` (personne ne peut
s'auto-valider) — vérifié par un test dédié. Toute exception, acceptée ou
refusée, génère une entrée `audit_logs`.

## 9. PAPEJ — financement en base, pas en constante applicative

`grants.amount_granted` (montant accordé) et `grants.amount_received`
(montant effectivement reçu, mis à jour uniquement par
`app_private.record_grant_receipt`, jamais supposé égal au montant
accordé) — colonnes distinctes, aucune des deux hardcodée dans le code
applicatif. `grant_budget_lines` reste configurable (pas de catégories
figées). Seed dev : `grants` avec `amount_granted = 850000`,
`amount_received` initialement `0`, incrémenté par un ou plusieurs appels
`record_grant_receipt` représentant les décaissements réels reçus.

## 10. Vues SQL — RLS respectée, pas contournée

`budget_line_balances` (et toute autre vue de métriques exposée à
l'API) est créée avec `security_invoker = true` : la vue s'exécute avec
les privilèges et les policies RLS du rôle appelant, pas du propriétaire.
Test dédié : isolation organisationnelle vérifiée **sur la vue
elle-même** (un acteur d'Org B interrogeant la vue ne voit aucune ligne
d'Org A), en plus des tests sur les tables sources.

## 11. Numérotation

Réutilisation stricte de `app_private.next_number_internal` (aucun
second mécanisme de séquence). Nouveaux `entity_type` ajoutés à
`seed_default_numbering_sequences` + backfill pour les organisations
existantes : `expense` (`DEP-2026-0001`), `journal_entry`
(`JE-2026-0001`). Pas de séquence dédiée aux références PAPEJ — un
`grant`/`grant_report` n'a pas besoin de numérotation automatique en
Phase 1C (volume trop faible, référence manuelle acceptable).

## 12. Sous-jalons internes (même phase, pas des phases séparées)

1C.1 Comptabilité minimale → 1C.2 Trésorerie → 1C.3 Budget → 1C.4
Dépenses → 1C.5 PAPEJ. Chaque sous-jalon : migration atomique, tests
ciblés, vérification RLS, commit atomique. **Phase 1C n'est déclarée
terminée qu'après validation de l'ensemble des 5 sous-jalons** et de la
chaîne de vérification complète.

## 13. Tests obligatoires (liste complète, en plus du plan de tests
initial déjà présenté)

- Deux engagements concurrents sur la même ligne budgétaire → un seul
  réussit.
- Aucun double comptage engagement/paiement (assertion arithmétique
  directe sur `budget_line_balances`).
- `INSERT` direct dans `budget_commitments` par un client authentifié →
  refusé (RLS).
- `UPDATE` direct de `expense_requests.status` (ou `expenses`,
  `journal_entries`) par un client authentifié → refusé (RLS), seule la
  RPC `security definer` peut muter.
- Écriture `posted` immuable (`UPDATE`/`DELETE` refusés).
- Lignes d'une écriture `posted` immuables.
- Contre-passation laissant l'écriture originale intacte.
- Dépense rattachée à une organisation différente → refusée.
- Compte de trésorerie d'une autre organisation → refusé.
- Ligne PAPEJ d'une autre organisation → refusée.
- Justificatif attaché à une dépense étrangère → refusé.
- Vue `budget_line_balances` respecte l'isolation organisationnelle.
- Aucun privilège `PUBLIC` indésirable sur les nouvelles fonctions
  (test générique, réutilisable pour toute phase future).

## 14. Standard `app_private` (obligatoire, reconduit de Phase 1B)

Pour toute nouvelle fonction `app_private`/`SECURITY DEFINER` : (1)
créer/remplacer ; (2) `revoke execute ... from public` explicite
immédiatement après création, dans la même migration ; (3) revoke
explicite sur `anon` quand pertinent (fonctions accessibles par RPC
publique) ; (4) `grant execute ... to <rôles nécessaires uniquement>` —
`authenticated` seulement pour les fonctions appelées directement par une
policy RLS ; (5) couverture par le test générique `routine_privileges`
(§13, tâche livrée avant le premier commit de schéma).

## Autorisation

Approuvé par Jean Alix Pierre le 15/08/2026, avec autorisation
d'implémentation directe (pas de second point de validation du plan).
Périmètre strict : Phase 1C uniquement, aucun début de Phase 1D ni
Phase 2. Rapport de clôture avec preuves complet exigé en fin de phase,
suivi d'un arrêt explicite pour validation.
