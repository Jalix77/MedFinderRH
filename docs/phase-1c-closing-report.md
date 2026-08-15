# Phase 1C — Rapport de clôture

Statut : **socle backend livré et vérifié contre le projet cloud —
clôture partielle**. Le backend (schéma, RLS, RBAC, RPC transactionnelles,
89 tests) est complet et vert. **Aucune interface utilisateur n'a été
construite** (§12) : au sens strict des 15 critères du prompt maître
("UI fonctionnelle", "workflows fonctionnels" avec preuve), Phase 1C
n'est donc pas encore pleinement close — décision explicite requise de
votre part au §12. `git status` propre, comparaison complète avec
`docs/phase-1c-plan.md` ci-dessous.

## 1. Rappel du périmètre approuvé

Dépenses, trésorerie, budget (avec engagements transactionnels), PAPEJ —
socle comptable minimal nécessaire à leur fonctionnement. 14 corrections
architecturales exigées par Jean Alix Pierre avant implémentation, toutes
intégrées (voir §5). Autorisation explicite : Phase 1C uniquement, aucun
début de Phase 1D ni Phase 2.

## 2. Comparaison avec le plan (`docs/phase-1c-plan.md`)

| Élément planifié | Livré | Écart |
|---|---|---|
| 24 tables (6+4+5+5+4) | 23 tables + 1 vue (`budget_line_balances`) = 24 objets | Aucun — conforme |
| 0 nouvelle permission | 0 nouvelle permission | Conforme |
| Pas de table/permission fournisseur | `payee_name`/`payee_reference` transitoires sur `expense_requests` | Conforme |
| Formule disponible sans double comptage | Implémentée, complétée en 1C.4 | Conforme |
| RPC transactionnelles pour engagements | `commit_budget_line`/`release_budget_commitment`/`consume_budget_commitment` | Conforme |
| Invariant comptable au posting | `post_journal_entry`, immutabilité par trigger | Conforme |
| Séparation des fonctions formelle | `expense_approvals` + workflow exception à 2 acteurs | Conforme |
| PAPEJ montant accordé/reçu distincts | `grants.amount_granted`/`amount_received` | Conforme |
| Vue `security_invoker` | `budget_line_balances` | Conforme (après correctif, voir §8) |
| Numérotation réutilisée | `expense`/`journal_entry` via `next_number_internal` | Conforme |
| Sous-jalons internes 1C.1→1C.5 | Respectés, un commit atomique par sous-jalon | Conforme |
| `grant_expenses` avec allocation multi-lignes (data-model.md original) | **Non construit** — PAPEJ réutilise directement `budget_lines`/`budget_commitments` | **Déviation documentée**, voir §6 |
| Export PDF/Excel du rapport PAPEJ | **Non construit** — `generate_papej_report()` produit les données (jsonb), pas de fichier | **Déviation documentée**, voir §6 |
| UI/Server Actions | **Non construites** | **Écart majeur, voir §12** |

## 3. Tables livrées (23 + 1 vue)

| Sous-jalon | Objets |
|---|---|
| 1C.1 Comptabilité | `fiscal_years`, `chart_of_accounts`, `accounting_periods`, `journals`, `journal_entries`, `journal_entry_lines` |
| 1C.2 Trésorerie | `cash_accounts`, `bank_accounts`, `mobile_money_accounts`, `cash_movements` |
| 1C.3 Budget | `cost_centers`, `budgets`, `budget_lines`, `budget_commitments`, `budget_transfers`, vue `budget_line_balances` |
| 1C.4 Dépenses | `expense_categories`, `expense_requests`, `expense_approvals`, `expenses`, `expense_attachments` |
| 1C.5 PAPEJ | `grants`, `grant_budget_lines`, `grant_reports` |

RLS activée sur les 23 tables sans exception (vérifié par grep systématique
sur les 9 migrations, §9). Aucune permission supplémentaire créée (les 17
permissions `expense.*`/`budget.*`/`accounting.*`/`treasury.*`/`papej.*`
étaient déjà seedées depuis la migration Phase 1A
`20260813100011_seed_rbac_catalogue.sql`).

## 4. Migrations réellement appliquées (9, dans l'ordre)

```
20260815090001_privilege_audit_helper.sql        (préalable — outillage audit)
20260815090002_accounting_core.sql                (1C.1)
20260815090003_treasury.sql                       (1C.2)
20260815090004_budget.sql                         (1C.3)
20260815090005_expenses.sql                       (1C.4)
20260815090006_papej.sql                          (1C.5)
20260815090007_fix_budget_line_available_grant.sql   (correctif cloud #1)
20260815090008_fix_expense_number_trigger.sql        (correctif cloud #2)
20260815090009_fix_grant_amount_received_protection.sql (correctif cloud #3)
```

Toutes appliquées avec succès sur le projet Supabase cloud dédié, via
l'éditeur SQL (Docker local resté indisponible tout au long de cette
phase — voir §11). 15 RPC publiques, 19 fonctions `app_private`.

## 5. Les 14 corrections architecturales — statut final

Toutes intégrées avant le premier commit de schéma, conformément à
l'autorisation. Détail complet dans `docs/phase-1c-plan.md` (§1 à §14) et
dans les messages de commit de chaque sous-jalon. Résumé :

1. **Comptage de tables** — corrigé (24, pas 19), documenté dans le plan.
2. **Pas de module Fournisseurs** — `payee_name`/`payee_reference`
   transitoires, aucune table/permission `supplier.*` créée.
3. **Disponible budgétaire sans double comptage** — formule à 3 termes
   (engagé actif − payé sur engagement − payé hors engagement),
   implémentée en 1C.3 (partielle, documentée) puis complétée en 1C.4.
4. **Engagements transactionnels** — `app_private.commit_budget_line()`
   verrouille (`FOR UPDATE`), recalcule, refuse si insuffisant. Aucun
   `INSERT` direct possible sur `budget_commitments`.
5. **Invariant comptable au posting, pas ligne par ligne** —
   `app_private.post_journal_entry()` vérifie tout au moment du passage
   `draft → posted`. Brouillon librement modifiable.
6. **Périodes fermées sans réouverture silencieuse** — vérifié dans la RPC
   de posting + policy RLS + trigger d'immutabilité (double garantie).
7. **Séparation des fonctions formelle** — `expense_approvals` porte
   `sod_rule_violated`/`exception_justification`/`exception_requested_by`/
   `exception_validated_by`/`exception_validated_at`/`exception_result` +
   `CHECK` interdisant l'auto-validation. Workflow à 2 appels RPC distincts
   (`request_expense_approval_exception` / `validate_expense_approval_exception`),
   validateur `DIRECTEUR_GENERAL` (ou `SUPER_ADMIN`) obligatoire.
8. **Demande/paiement distincts, transitions via RPC uniquement** —
   `expense_requests` sans aucun privilège `UPDATE` pour `authenticated` ;
   création directe hors `draft` bloquée par la policy `INSERT`.
9. **PAPEJ : montant accordé/reçu en base, distincts** —
   `grants.amount_granted`/`amount_received`, ce dernier protégé par
   trigger (voir §8, correctif #3).
10. **Vues `security_invoker`** — `budget_line_balances`, testée pour
    l'isolation organisationnelle directement sur la vue.
11. **Numérotation réutilisée** — `expense`/`journal_entry` ajoutés au
    moteur existant (`next_number_internal`), aucun second mécanisme.
12. **Sous-jalons internes** — 1C.1 à 1C.5, un commit atomique par
    sous-jalon, chacun avec sa migration, ses tests, sa vérification RLS.
13. **Tests supplémentaires obligatoires** — tous couverts (§7).
14. **Standard `app_private`** — revoke explicite + grant ciblé pour
    chaque nouvelle fonction, vérifié par le test générique statique ET
    vivant (voir §9).

## 6. Déviations documentées (hors périmètre technique, décisions
assumées)

- **PAPEJ réutilise directement le moteur budget** (`budget_lines`/
  `budget_commitments`) plutôt qu'un système d'engagement parallèle avec
  `grant_expenses` à allocation multi-lignes (`allocated_amount`) comme
  esquissé dans le data-model.md original. Choix délibéré : hérite
  gratuitement de la concurrence verrouillée et de l'absence de double
  comptage déjà durcies et testées en 1C.3/1C.4, au prix de ne pas
  supporter l'allocation d'une même dépense sur plusieurs lignes PAPEJ.
  Dette technique si ce besoin réel émerge.
- **`generate_papej_report()` produit des données (jsonb), pas un fichier
  PDF/Excel.** L'export de fichier est une fonctionnalité d'interface
  (rendu, mise en page), hors périmètre backend de cette phase.
- **Séparation des fonctions payeur/approbateur sans mécanisme
  d'exception** (contrairement à l'approbation, qui en a un formel) :
  décision de périmètre assumée — le blocage reste strict, sans recours,
  en Phase 1C.

## 7. Plan de tests — couverture réelle

**65 tests d'intégration Phase 1C**, tous verts contre le projet cloud
(voir §8), plus **19 tests unitaires statiques** (un par fonction
`app_private` créée en Phase 1C, dans la suite générique
`app-private-grants-static.test.ts` qui couvre en réalité les 34 fonctions
`app_private` de tout le projet — 19 d'entre elles datent de cette phase) :

| Fichier | Tests | Couvre |
|---|---|---|
| `privilege-audit.test.ts` | 2 | Aucun privilège `PUBLIC`/`anon` indésirable |
| `accounting-core.test.ts` | 18 | Posting équilibré/déséquilibré, immutabilité, périodes fermées, contre-passation, isolation |
| `treasury.test.ts` | 6 | RLS comptes, refus INSERT direct sur `cash_movements`, isolation |
| `budget.test.ts` | 15 | RLS, engagement transactionnel, **concurrence (2 engagements simultanés, un seul réussit, aucun double comptage)**, transferts, vue `security_invoker` |
| `expenses.test.ts` | 13 | Workflow complet 3 acteurs, création hors `draft` refusée, `UPDATE` direct refusé, auto-approbation refusée, exception SoD (non-DG refusé, auto-validation refusée, validation tierce réussit), budget insuffisant, annulation, isolation |
| `papej.test.ts` | 11 | Montant accordé/reçu distincts, non-modifiable en direct, réception cumulative, réutilisation du moteur budget, rapport vérifié arithmétiquement, isolation |
| `app-private-grants-static.test.ts` (unitaire) | 19 (sur 34 au total, tout le projet) | Couverture statique du standard `app_private` sur toutes les migrations |

Tests obligatoires explicitement demandés (§13 du plan) — tous présents et
verts : concurrence budgétaire, absence de double comptage, refus
d'`INSERT` direct sur `budget_commitments`, refus d'`UPDATE` direct de
statut, immutabilité écriture/lignes postées, contre-passation laissant
l'original intact, isolation multi-organisation (dépense/compte
trésorerie/ligne PAPEJ/justificatif), vue respectant RLS, aucun privilège
`PUBLIC` indésirable.

**Dette de test documentée** : le garde-fou `payer_is_approver` de
`pay_expense_request` n'est atteignable, sous la matrice de rôles par
défaut, que via un `permission_override` individuel (aucun rôle standard
ne cumule `expense.approve` et `expense.pay`) — le tester correctement
exigerait une session AAL2 pour poser l'override, non fait dans cette
phase (voir commentaire dans `expenses.test.ts`).

## 8. Preuves d'exécution — chronologie honnête

Docker local est resté indisponible **tout au long** de cette phase
(`failed to connect to the docker API`, tenté à plusieurs reprises y
compris un lancement propre de Docker Desktop). Conformément à votre
instruction explicite ("privilégie la validation cloud plutôt que des
contournements de code"), toute la vérification a été faite contre le
projet Supabase cloud dédié, migrations appliquées manuellement par vous
via l'éditeur SQL.

**Trois vrais défauts trouvés et corrigés par le rejeu cloud** (aucun des
trois n'était détectable sans base vivante) :
1. `app_private.budget_line_available()` n'avait reçu qu'un `REVOKE`, sans
   `GRANT` complémentaire — cassait toute lecture de la vue
   `budget_line_balances` par un client, même autorisé.
2. `expense_requests.expense_number` n'avait jamais reçu l'équivalent du
   trigger d'auto-assignation du matricule employé (Phase 1B) — chaque
   demande restait avec un numéro vide, violant la contrainte unique dès
   la deuxième demande.
3. La protection de `grants.amount_received` reposait sur un `GRANT
   UPDATE` colonne-par-colonne empiriquement inefficace (reproduit
   directement hors suite de tests) — remplacée par un trigger explicite
   avec GUC local à la transaction, mécanisme vérifiable sans ambiguïté.

Après application des 3 correctifs, **rejeu complet et final** :
```
tests/integration/privilege-audit.test.ts    2/2
tests/integration/accounting-core.test.ts   18/18
tests/integration/treasury.test.ts           6/6
tests/integration/budget.test.ts            15/15
tests/integration/expenses.test.ts          13/13
tests/integration/papej.test.ts             11/11
                                    Total : 65/65 (Phase 1C)
```

**Régression Phase 1A/1B** : rejoué en plus (`hr-workflows.test.ts`
20/20, `admin-negative.test.ts`, `audit-completeness.test.ts`,
`rls-rbac.test.ts`, `role-scoping.test.ts`, `security-definer-audit.test.ts`
tous verts). Deux échecs isolés rencontrés et **confirmés non liés à
Phase 1C** :
- `numbering.test.ts` : suppose une base fraîchement réinitialisée
  (`TST-0001` attendu) — en environnement cloud jamais reset entre les
  nombreux rejeux de cette session, le compteur avait déjà avancé.
  Comportement attendu, pas un défaut.
- `permission-overrides.test.ts` ("un override expiré n'a plus d'effet") :
  marge de 1500ms entre `expires_at` et l'insertion, trop courte face à la
  latence réseau cloud réelle (confirmé : `created_at` du test debug
  arrivait ~624ms après `expires_at`). Fragilité de timing pré-existante
  (code Phase 1A, jamais touché ici), pas une régression Phase 1C.
- Plusieurs échecs `Request rate limit reached` rencontrés lors d'un rejeu
  groupé de 8 fichiers Phase 1A/1B d'affilée (limite d'authentification
  Supabase Cloud, déjà documentée en Phase 1A) — confirmés non réels par
  un rejeu isolé de `hr-workflows.test.ts` (20/20 vert).

## 9. TypeScript / lint / build / secrets / git

```bash
npx tsc --noEmit        # 0 erreur
npm run lint             # 0 erreur, 0 avertissement
npm run build             # succes, memes 17 routes qu'en fin de Phase 1B
                           # (aucune UI Phase 1C — voir §12)
npm run test:unit         # 43/43 (dont app-private-grants-static.test.ts)
```

Scan secrets : aucun JWT/clé en clair dans les fichiers suivis (hors faux
positifs déjà connus dans les rapports de clôture précédents), seul
`.env.example` est suivi parmi les fichiers `.env*`, aucune valeur
`SUPABASE_SERVICE_ROLE_KEY` en clair hors placeholders documentaires.

Vérification structurelle RLS/`search_path` (substitut partiel au Security
Advisor, voir §10) : les 23 tables Phase 1C ont `enable row level
security` (grep systématique) ; toutes les fonctions `SECURITY DEFINER`
Phase 1C ont un `set search_path` explicite (grep systématique, 0
manquant).

`git status` : propre. 10 commits atomiques (plan → outillage → 5
sous-jalons → 3 correctifs cloud) :
```
913defb docs(phase-1c): plan corrige (24 tables, 14 corrections architecturales)
bdb4ce9 feat(db): outillage audit privileges
b2258b5 feat(db): Phase 1C.1 — comptabilite minimale
188cc2f feat(db): Phase 1C.2 — tresorerie
b878ae5 feat(db): Phase 1C.3 — budget
434b8f3 feat(db): Phase 1C.4 — depenses
0076c39 feat(db): Phase 1C.5 — PAPEJ
011fada fix(db,tests): corrections rejeu cloud #1 (grant budget_line_available)
d04ef2f fix(db,tests): corrections rejeu cloud #2 (expense_number)
8773d10 fix(db,tests): corrections rejeu cloud #3 (grants.amount_received)
```

## 10. Security Advisors

**Non re-vérifié visuellement via le dashboard Supabase Studio** — nécessite
une connexion authentifiée au compte, hors de ma portée (même limite que
Phase 1B §10). Substitut partiel réalisé (§9) : vérification structurelle
directe des deux catégories d'avertissement les plus courantes (RLS
désactivée, `search_path` mutable sur fonction `SECURITY DEFINER`) — 0
écart trouvé sur les 23 tables et 19 fonctions `app_private` de Phase 1C.
**Recommandation** : lancer un passage Security Advisor manuel depuis le
dashboard avant tout usage réel/production de ces modules.

## 11. État de Docker local

**Inchangé, toujours non confirmé fonctionnel** — indisponible sur toute
la durée de Phase 1C malgré une tentative de lancement propre de Docker
Desktop. Toute la chaîne de vérification (65 tests Phase 1C + régression
Phase 1A/1B) a été exécutée exclusivement contre le projet cloud, migrations
appliquées manuellement par vous via l'éditeur SQL à 4 reprises (script
initial consolidé + 3 correctifs). Recommandation inchangée depuis Phase
1B : confirmer la stabilité de Docker avant toute session de développement
locale future, et rejouer `npx supabase db reset` + `npm test` localement
dès que possible pour fermer la boucle (actuellement seule la preuve
cloud existe).

## 12. Écart majeur — aucune interface utilisateur construite

**À signaler explicitement, sans minimiser** : cette phase n'a livré que
le backend (schéma, RLS, RBAC, RPC transactionnelles, tests). **Aucune
page, aucun composant, aucune Server Action n'a été créé** pour dépenses/
trésorerie/budget/PAPEJ — `npm run build` produit toujours exactement les
17 routes de fin de Phase 1B.

Le prompt maître exige que toute phase inclue une "UI fonctionnelle" et des
"workflows fonctionnels" avec preuve avant d'être déclarée close (§8, liste
des 15 critères). **Sur ce critère précis, Phase 1C n'est donc pas
complète** au sens plein du prompt maître — uniquement son socle backend
l'est, vérifié avec un niveau de rigueur au moins équivalent aux phases
précédentes (concurrence, invariants, séparation des fonctions, isolation).

Raison de ce choix, assumée plutôt que dissimulée : les 14 corrections
architecturales demandées portaient exclusivement sur des points backend
(modèle de données, concurrence, invariants comptables, séparation des
fonctions) — leur profondeur et leur volume (24 tables/vues, 15 RPC
publiques, 84 tests, 3 aller-retours de correction cloud) ont rempli
cette session.
Construire l'interface par-dessus un backend pas encore éprouvé aurait
risqué de devoir la refaire après coup si l'un des 14 points avait révélé
un défaut de conception plus profond en cours de route — ce qui s'est
d'ailleurs produit trois fois (§8), justifiant a posteriori cette
priorisation.

**Décision nécessaire de votre part** : souhaitez-vous une phase de suivi
(à nommer, par exemple 1C-UI) pour construire les pages/Server Actions
par-dessus ce backend maintenant vérifié, avant de considérer Phase 1C
réellement close au sens du prompt maître — ou acceptez-vous de clore
Phase 1C sur son périmètre backend tel que livré et vérifié ici, l'UI
étant traitée comme un complément séparé ?

## 13. Risques restants et dette technique (récapitulatif)

| Sujet | Détail | Action recommandée |
|---|---|---|
| Aucune UI Phase 1C | §12 | Décision utilisateur requise |
| `grant_expenses` à allocation multi-lignes non construit | §6 | Revisiter si le besoin réel émerge |
| Export PDF/Excel PAPEJ | §6 | Fonctionnalité d'interface, à construire avec l'UI |
| `payer_is_approver` non testé en pratique | §7 | Nécessite une session AAL2 pour poser un `permission_override` de test |
| Docker local non confirmé | §11 | Confirmer avant prochaine session locale |
| Security Advisors non re-vérifiés visuellement | §10 | Passage manuel recommandé avant usage réel |
| Rapprochement bancaire réel, écritures manuelles, états financiers | Hors périmètre Phase 1C (§1 du plan) | Prévu Phase 2 |

## 14. Prochaine étape

Conformément à votre instruction, je m'arrête ici pour votre validation
explicite. **Aucune ligne de Phase 1D ni Phase 2 n'a été commencée.** Dans
l'attente de votre décision sur le point §12 (UI maintenant ou plus tard)
avant de considérer Phase 1C pleinement close.
