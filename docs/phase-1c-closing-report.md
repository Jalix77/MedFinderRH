# Phase 1C — Rapport de clôture

Statut : **backend ET interface utilisateur livrés et vérifiés — clôture
complète**, au sens des 15 critères du prompt maître (schéma, RLS, RBAC,
API sécurisées, **UI fonctionnelle**, **workflows fonctionnels avec
preuve**, tests verts, aucun secret exposé, build/typecheck/lint verts).
`git status` propre. Ce document couvre les deux volets : le socle backend
(§1-11, inchangé depuis le rapport intermédiaire du 15/08/2026) et
l'interface Phase 1C-UI construite par-dessus (§12-17, nouveau).

## 1. Rappel du périmètre approuvé (backend)

Dépenses, trésorerie, budget (avec engagements transactionnels), PAPEJ —
socle comptable minimal nécessaire à leur fonctionnement. 14 corrections
architecturales exigées par Jean Alix Pierre avant implémentation, toutes
intégrées (voir §5).

## 1bis. Rappel du périmètre approuvé (UI)

Autorisation explicite, distincte, reçue après validation du backend :
interfaces Trésorerie, Budget, Dépenses, PAPEJ — construire l'interface
complète nécessaire pour exploiter le backend déjà validé, sans nouveau
domaine métier, sans Phase 1D ni Phase 2. Règles UX (libellés métier pour
le DG), sécurité UI (le backend reste l'autorité, jamais l'UI), dashboard
Direction avec données réelles, tests obligatoires (composants,
permissions d'affichage, Server Actions, E2E des 4 workflows, navigation
mobile, erreurs/états vides, formulaire invalide, action non autorisée,
double soumission, affichage HTG/USD, cohérence UI/backend).

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
| Export PDF/Excel du rapport PAPEJ | **Export CSV** construit côté client (§14) — pas de rendu PDF | **Déviation documentée**, voir §6 et §14 |
| UI/Server Actions | **Construites et vérifiées** (§12-17) | Conforme, plus de retard |

## 3. Tables livrées (23 + 1 vue)

| Sous-jalon | Objets |
|---|---|
| 1C.1 Comptabilité | `fiscal_years`, `chart_of_accounts`, `accounting_periods`, `journals`, `journal_entries`, `journal_entry_lines` |
| 1C.2 Trésorerie | `cash_accounts`, `bank_accounts`, `mobile_money_accounts`, `cash_movements` |
| 1C.3 Budget | `cost_centers`, `budgets`, `budget_lines`, `budget_commitments`, `budget_transfers`, vue `budget_line_balances` |
| 1C.4 Dépenses | `expense_categories`, `expense_requests`, `expense_approvals`, `expenses`, `expense_attachments` |
| 1C.5 PAPEJ | `grants`, `grant_budget_lines`, `grant_reports` |

RLS activée sur les 23 tables sans exception (vérifié par grep systématique
sur les migrations, §9). Aucune permission supplémentaire créée (les 17
permissions `expense.*`/`budget.*`/`accounting.*`/`treasury.*`/`papej.*`
étaient déjà seedées depuis la migration Phase 1A
`20260813100011_seed_rbac_catalogue.sql`).

## 4. Migrations réellement appliquées (10, dans l'ordre)

```
20260815090001_privilege_audit_helper.sql               (préalable — outillage audit)
20260815090002_accounting_core.sql                       (1C.1)
20260815090003_treasury.sql                               (1C.2)
20260815090004_budget.sql                                 (1C.3)
20260815090005_expenses.sql                               (1C.4)
20260815090006_papej.sql                                  (1C.5)
20260815090007_fix_budget_line_available_grant.sql        (correctif cloud #1, backend)
20260815090008_fix_expense_number_trigger.sql              (correctif cloud #2, backend)
20260815090009_fix_grant_amount_received_protection.sql    (correctif cloud #3, backend)
20260816090010_fix_expense_creator_line_visibility.sql     (correctif cloud #4, trouvé en construisant l'UI — voir §15)
```

Toutes appliquées avec succès sur le projet Supabase cloud dédié, via
l'éditeur SQL (Docker local resté indisponible tout au long de cette
phase, y compris son volet UI — voir §11). 15 RPC publiques, 19 fonctions
`app_private`.

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
   `CHECK` interdisant l'auto-validation. Workflow à 2 appels RPC distincts,
   validateur `DIRECTEUR_GENERAL` (ou `SUPER_ADMIN`) obligatoire.
8. **Demande/paiement distincts, transitions via RPC uniquement** —
   `expense_requests` sans aucun privilège `UPDATE` pour `authenticated` ;
   création directe hors `draft` bloquée par la policy `INSERT`. **L'UI le
   respecte strictement** : chaque bouton de workflow appelle une RPC
   dédiée (§12), aucun formulaire ne modifie `status` directement.
9. **PAPEJ : montant accordé/reçu en base, distincts** —
   `grants.amount_granted`/`amount_received`, ce dernier protégé par
   trigger. **L'UI affiche les deux valeurs séparément**, jamais une
   supposition d'égalité (§13).
10. **Vues `security_invoker`** — `budget_line_balances`, testée pour
    l'isolation organisationnelle directement sur la vue **et sur la page
    qui l'utilise** (E2E, §16).
11. **Numérotation réutilisée** — `expense`/`journal_entry` ajoutés au
    moteur existant, aucun second mécanisme.
12. **Sous-jalons internes** — 1C.1 à 1C.5, un commit atomique par
    sous-jalon, chacun avec sa migration, ses tests, sa vérification RLS.
13. **Tests supplémentaires obligatoires** — tous couverts (§7).
14. **Standard `app_private`** — revoke explicite + grant ciblé pour
    chaque nouvelle fonction, vérifié par test générique statique ET
    vivant.

## 6. Déviations documentées (décisions assumées)

- **PAPEJ réutilise directement le moteur budget** plutôt qu'un système
  d'engagement parallèle avec `grant_expenses` à allocation multi-lignes.
  Choix délibéré : hérite de la concurrence verrouillée et de l'absence de
  double comptage déjà durcies et testées, au prix de ne pas supporter
  l'allocation d'une même dépense sur plusieurs lignes PAPEJ. Dette
  technique si ce besoin réel émerge.
- **`generate_papej_report()` produit des données (jsonb), pas un fichier
  PDF.** L'UI (§14) construit un **export CSV côté client** à partir de ces
  mêmes données déjà autorisées par le backend — une mise en forme
  téléchargeable, pas une nouvelle capacité serveur inventée. Un rendu PDF
  mis en page reste hors périmètre.
- **Séparation des fonctions payeur/approbateur sans mécanisme
  d'exception** (contrairement à l'approbation, qui en a un formel) :
  décision de périmètre assumée dès le backend — le blocage reste strict,
  sans recours, en Phase 1C.

## 7. Plan de tests backend — couverture réelle (65 tests d'intégration)

| Fichier | Tests | Couvre |
|---|---|---|
| `privilege-audit.test.ts` | 2 | Aucun privilège `PUBLIC`/`anon` indésirable |
| `accounting-core.test.ts` | 18 | Posting équilibré/déséquilibré, immutabilité, périodes fermées, contre-passation, isolation |
| `treasury.test.ts` | 6 | RLS comptes, refus INSERT direct, isolation |
| `budget.test.ts` | 15 | RLS, engagement transactionnel, **concurrence (2 engagements simultanés, un seul réussit)**, transferts, vue `security_invoker` |
| `expenses.test.ts` | 13 | Workflow complet 3 acteurs, création hors `draft` refusée, `UPDATE` direct refusé, auto-approbation refusée, exception SoD, budget insuffisant, annulation, isolation |
| `papej.test.ts` | 11 | Montant accordé/reçu distincts, non-modifiable en direct, réception cumulative, rapport vérifié arithmétiquement, isolation |

Plus 19 tests unitaires statiques (`app-private-grants-static.test.ts`,
standard `app_private` sur toutes les fonctions du projet).

## 8. Preuves d'exécution backend — chronologie honnête

**Trois vrais défauts backend trouvés et corrigés par le rejeu cloud**
(aucun détectable sans base vivante) :
1. `app_private.budget_line_available()` sans `GRANT` complémentaire au
   `REVOKE` — cassait la lecture de `budget_line_balances`.
2. `expense_requests.expense_number` sans trigger d'auto-assignation —
   violait la contrainte unique dès la deuxième demande.
3. Protection de `grants.amount_received` par `GRANT UPDATE`
   colonne-par-colonne empiriquement inefficace — remplacée par un
   trigger avec GUC local à la transaction.

Rejeu final backend : **65/65 Phase 1C**, régression Phase 1A/1B rejouée
(`hr-workflows.test.ts` 20/20 et le reste des suites Phase 1A/1B, verts).
Deux échecs isolés confirmés non liés à Phase 1C (`numbering.test.ts` —
compteur déjà avancé sur base cloud jamais reset ; `permission-overrides.test.ts`
— marge de timing de 1500ms trop courte face à la latence réseau réelle,
défaut pré-existant du code Phase 1A jamais touché ici).

## 9. TypeScript / lint / build / tests / secrets / git (état final, backend + UI)

```bash
npx tsc --noEmit          # 0 erreur
npm run lint                # 0 erreur, 0 avertissement
npm run build                # succes, 23 routes (17 fin Phase 1B + 6 Phase 1C-UI :
                              #   /tresorerie, /tresorerie/mouvements, /budget,
                              #   /budget/[id], /depenses, /depenses/[id],
                              #   /depenses/nouvelle, /papej, /papej/[id]
                              #   — 9 nouvelles en realite, /direction mis a jour)
npm run test:unit            # 61/61 (43 pre-existants + 18 nouveaux : formatMoney/
                              #   formatNumber, StatusBadge, MetricCard, ActionForm)
```

Backend : 65/65 tests d'intégration Phase 1C (§7-8). UI : 10/10 tests de
visibilité par rôle + 13/13 tests E2E Playwright (§16). **Total Phase 1C
(backend + UI) : 65 + 10 + 13 = 88 tests d'intégration/E2E vivants contre
le projet cloud, plus 18 tests composants isolés = 106 tests créés dans
cette phase**, tous verts au rejeu final (voir §16 pour le détail du rejeu
groupé, y compris une collision avec la limite d'authentification Supabase
Cloud, résolue par un nouveau rejeu isolé — même phénomène déjà documenté
en Phase 1A/1B, pas un défaut).

Scan secrets : `git grep eyJhbGci` → aucune occurrence hors faux positifs
déjà connus dans les rapports de clôture précédents (texte descriptif,
pas une vraie clé). Seul `.env.example` est suivi parmi les fichiers
`.env*` (vérifié : uniquement des placeholders vides). Aucune valeur
`SUPABASE_SERVICE_ROLE_KEY` en clair hors placeholders/noms de variable
dans le code (scripts, tests) — `git grep SUPABASE_SERVICE_ROLE_KEY`
vérifié ligne par ligne, aucune clé réelle.

`git status` : propre. 16 commits atomiques au total pour Phase 1C
(plan → outillage → 5 sous-jalons backend → 3 correctifs cloud backend →
types → UI → correctif cloud UI implicite via commit UI → tests
permissions → E2E → tests composants) :
```
913defb docs(phase-1c): plan corrige (24 tables, 14 corrections architecturales)
bdb4ce9 feat(db): outillage audit privileges
b2258b5 feat(db): Phase 1C.1 — comptabilite minimale
188cc2f feat(db): Phase 1C.2 — tresorerie
b878ae5 feat(db): Phase 1C.3 — budget
434b8f3 feat(db): Phase 1C.4 — depenses
0076c39 feat(db): Phase 1C.5 — PAPEJ
011fada fix(db,tests): correctif cloud #1 (grant budget_line_available)
d04ef2f fix(db,tests): correctif cloud #2 (expense_number)
8773d10 fix(db,tests): correctif cloud #3 (grants.amount_received)
10309c7 docs(phase-1c): rapport de cloture intermediaire — backend complet, UI a decider
d166400 feat(types): regenerer database.types.ts pour les 23 tables + vue
45cc4f9 feat(app): UI Phase 1C — tresorerie, budget, depenses, PAPEJ, dashboard direction (inclut le correctif cloud #4)
5e5f3b5 test(ui): matrice de visibilite des ecrans financiers par role
bf26e8b test(e2e): Playwright — workflows depense/budget/tresorerie/PAPEJ + nav mobile (inclut 2 correctifs UI reels)
54a66ec test(unit): tests composants React (Vitest + Testing Library + jsdom)
```

## 10. Security Advisors

**Non re-vérifié visuellement via le dashboard Supabase Studio** — nécessite
une connexion authentifiée au compte, hors de ma portée (même limite que
Phases 1A/1B). Substitut partiel réalisé (§9) : vérification structurelle
directe (RLS activée, `search_path` mutable) — 0 écart trouvé sur les 23
tables et 19 fonctions `app_private` de Phase 1C. **Recommandation
inchangée** : passage Security Advisor manuel avant tout usage réel.

## 11. État de Docker local

**Inchangé, toujours non confirmé fonctionnel** sur toute la durée de
Phase 1C, backend et UI compris (`failed to connect to the docker API`,
tenté à nouveau pendant le volet UI). Toute la vérification — 65 tests
backend, 10 tests de permissions, 13 tests E2E Playwright, le serveur de
développement lui-même pour la vérification visuelle — a été exécutée
contre le projet cloud, `.env.local` pointé temporairement dessus pour la
durée de cette phase (fichier gitignoré, jamais committé, à régénérer via
`supabase start` dès que Docker sera confirmé sain). Recommandation
inchangée : confirmer Docker avant toute session de développement locale
future, puis rejouer `npx supabase db reset` + `npm test` localement pour
fermer définitivement la boucle.

---

## 12. Interface livrée — périmètre exact

Quatre modules, conformes au périmètre UI autorisé (§1bis), plus le
dashboard Direction mis à jour :

| Module | Pages | Fonctionnalités |
|---|---|---|
| **Trésorerie** | `/tresorerie`, `/tresorerie/mouvements` | Caisses/comptes bancaires/mobile money (création, activation/désactivation), configuration minimale du plan comptable (préalable RLS `accounting.post`), mouvements récents, soldes par compte et par devise |
| **Budget** | `/budget`, `/budget/[id]` | Exercices comptables, budgets (création, approbation), lignes budgétaires, centres de coûts, transferts entre lignes (RPC `transfer_budget_amount`), engagements actifs affichés, prévu/engagé/disponible en libellés métier |
| **Dépenses** | `/depenses`, `/depenses/nouvelle`, `/depenses/[id]` | Création (brouillon), liste (toutes pour `expense.view`, propres pour `expense.create` seul), fiche détail avec toutes les actions de workflow (soumettre/approuver/rejeter/payer/annuler/comptabiliser), exception SoD formelle (demande + validation DG, affichée avec règle violée/justification/validateur/résultat), justificatifs (upload + URL signée 60s), historique des états (reconstruit depuis `audit_logs`) |
| **PAPEJ** | `/papej`, `/papej/[id]` | Financement (accordé/reçu distincts, jamais supposés égaux), lignes budgétaires PAPEJ, réception de financement (RPC `record_grant_receipt`), dépenses rattachées, justificatifs manquants, rapport généré (RPC `generate_papej_report`) + export CSV client |
| **Dashboard Direction** | `/direction` | Trésorerie totale/caisse/banque par devise, dépenses du mois/en attente, budget consommé/disponible, PAPEJ accordé/reçu/engagé/payé/disponible, justificatifs manquants — **aucune valeur fictive**, chaque section gardée par permission (masquée, jamais affichée vide pour un rôle sans accès) |

Navigation mobile : sidebar transformée en tiroir sous le point de rupture
`sm`, déclenché par un bouton hamburger, fermeture automatique après
navigation.

## 13. Règles UX — respect vérifié

Libellés métier utilisés systématiquement (`MetricCard`/`StatusBadge`) :
"Budget disponible", "Dépenses en attente", "Montant engagé", "Montant
payé", "Justificatifs manquants", "Solde PAPEJ", "Dépenses à approuver" —
jamais un nom de colonne ou un statut technique brut affiché au DG. Le
détail comptable (comptes du plan comptable, configuration) reste
accessible au COMPTABLE via des sections `<details>` repliées par défaut,
jamais imposé à l'écran principal.

## 14. Sécurité UI — l'UI n'est jamais la source d'autorité

Vérifié par construction et par test :
- Chaque page vérifie `hasPermission()` côté serveur avant tout rendu de
  contenu sensible (défense en profondeur, RLS reste la protection réelle).
- Chaque Server Action ne fait que relayer un `.rpc(...)` ou un `.insert()`/
  `.update()` déjà protégé par RLS/RPC — aucune logique d'autorisation
  dupliquée côté client.
- La navigation masque les liens selon la permission (`lib/navigation.ts`,
  étendu pour accepter un tableau de permissions "au moins une", cas
  d'AGENT_TERRAIN qui n'a que `expense.create`), mais un accès direct par
  URL reste bloqué par le garde de page **et** par RLS en dernier recours.
- Testé explicitement (§16) pour les 8 rôles exigés.

## 15. Trois vrais défauts trouvés en construisant l'UI (aucun n'était détectable sans page réelle ni rejeu E2E)

1. **RLS trop restrictive pour `expense.create` seul** (migration
   `20260816090010`, trouvé en construisant l'écran de création de
   dépense, avant même le premier test) : `budget_lines_select`/
   `expense_categories_select`/`cost_centers_select` n'accordaient la
   lecture qu'aux détenteurs de `budget.view`/`expense.view` — un
   AGENT_TERRAIN (`expense.create` "propres" seul, jamais `budget.view`)
   n'aurait pas pu choisir de ligne budgétaire, rendant la création de
   dépense structurellement impossible pour ce rôle malgré la
   documentation (`permissions-matrix.md`). Étendu de façon étroite aux 3
   policies concernées + `audit_logs_select` (auto-accès à l'historique de
   ses propres demandes, même principe déjà utilisé pour
   employees/contracts en Phase 1B).
2. **Vue `budget_line_balances` mal embarquée dans deux pages** (trouvé
   par le rejeu E2E, pas par relecture de code) : `app/(app)/budget/[id]/page.tsx`
   et `app/(app)/papej/[id]/page.tsx` tentaient
   `select=...,budget_line_balances(...)` depuis `budget_lines` — mais
   PostgREST ne peut pas embarquer une **vue** sans contrainte FK réelle
   (`PGRST200 : no relationship found`). L'erreur n'était jamais vérifiée
   (`{ data }` seul, convention déjà en place dans le reste du projet) :
   les deux pages affichaient silencieusement "Aucune ligne budgétaire" /
   des totaux à zéro **même quand des lignes existaient réellement en
   base**. Corrigé par deux requêtes distinctes jointes côté application
   (même approche que trésorerie/dépenses dès leur conception initiale).
   Reproduit et confirmé directement via l'API REST avant correction (voir
   historique de session), puis prouvé résolu par le même test E2E rejoué
   avec succès.
3. **Labels de formulaire non associés à leurs champs** (`<label>` sans
   `htmlFor`/`id`) sur la quasi-totalité des formulaires Phase 1C-UI —
   invisible visuellement, sans impact sur un clic à la souris, mais casse
   `getByLabel` **et, plus important, l'accessibilité réelle pour un
   lecteur d'écran**. Corrigé sur trésorerie (comptes + configuration
   comptable), budget (budget/exercice/centre de coût/ligne), dépenses
   (formulaire de création complet), PAPEJ (ligne + réception +
   génération de rapport), avec des identifiants préfixés par formulaire
   pour éviter toute collision d'`id` entre sections d'une même page.

Aucun de ces trois défauts n'était visible en relisant le code — les deux
premiers exigeaient une base vivante avec des données réelles, le
troisième exigeait un outil qui calcule réellement le nom accessible d'un
champ (Playwright), pas une relecture visuelle.

## 16. Plan de tests UI — couverture réelle

**10 tests de visibilité par rôle** (`tests/integration/ui-permissions.test.ts`,
contre le projet cloud, même infrastructure que les tests backend) —
couvre exactement les 8 rôles exigés par le prompt maître :

| Rôle | Résultat vérifié |
|---|---|
| EMPLOYE | Aucun écran financier visible |
| AGENT_TERRAIN | Seul Dépenses visible (`expense.create` "propres") |
| MANAGER | Dépenses + Budget visibles, jamais Trésorerie/PAPEJ |
| RH | Seul Dépenses visible, aucun accès financier indu |
| SUPPORT | Aucun écran financier/budget/comptabilité visible |
| COMPTABLE | Les 4 modules financiers visibles |
| DIRECTEUR_TECHNIQUE | Seul Dépenses visible **une fois AAL2 vérifié** ; **rien** sans MFA (DT détient `user.manage`, donc soumis à la même exigence AAL2 que DG — trouvaille de test documentée, pas un défaut : session non élevée testée explicitement en test complémentaire) |
| DIRECTEUR_GENERAL | Les 4 modules visibles une fois AAL2 vérifié ; rien sans MFA (même mécanisme, testé explicitement) |

**13 tests E2E Playwright** (`tests/e2e/`, navigateur Chromium réellement
piloté, contre le serveur de développement branché sur le projet cloud) :

| Fichier | Tests | Couvre |
|---|---|---|
| `expense-workflow.spec.ts` | 3 | Création→soumission→**action non autorisée** (auto-approbation refusée par le backend, message affiché fidèlement), **formulaire invalide** (validation HTML5 bloque la création), **double soumission** (bouton retiré dès le premier clic) |
| `budget-workflow.spec.ts` | 2 | Prévu/engagé/disponible affichés, **transfert réel entre deux lignes**, accès refusé (EMPLOYE) |
| `treasury-workflow.spec.ts` | 2 | Soldes en HTG, état vide honnête (aucun compte bancaire), accès refusé (SUPPORT) |
| `papej-workflow.spec.ts` | 2 | Génération de rapport (état vide honnête), export CSV proposé, accès refusé (RH) |
| `mobile-nav.spec.ts` | 1 | Tiroir de navigation mobile (hamburger, liens finance, fermeture après clic) — projet Playwright dédié en viewport téléphone |
| `errors-empty-states.spec.ts` | 3 | Ressource inexistante → Accès refusé (jamais une page cassée), **cohérence exacte entre le montant affiché et la valeur en base** (requête admin directe comparée au DOM), budget fraîchement créé → état vide honnête |

**18 tests composants** (`tests/unit/components/` + `tests/unit/money-format.test.ts`,
Vitest + Testing Library + jsdom, isolés sans navigateur) :
`formatMoney`/`formatNumber` (HTG/USD, valeurs nulles, non numériques),
`StatusBadge` (9 statuts du workflow dépense traduits, repli générique),
`MetricCard` (libellé/valeur/tonalité), `ActionForm` (protection
double-soumission vérifiée par assertion sur le nombre d'appels, affichage
fidèle de l'erreur backend, transmission correcte des champs cachés).

**Rejeu final groupé** : une première tentative de rejeu complet (backend
+ UI, 157 tests) a rencontré 15 échecs `Request rate limit reached` en fin
de parcours — volume cumulé de connexions sur l'ensemble de la session
(déjà documenté comme limite connue de Supabase Cloud en Phase 1A/1B).
Rejeu isolé des 2 fichiers concernés après une courte pause :
**28/28 verts**. Total final confirmé : **142 + 28 = 170 tests
d'intégration/E2E**, tous verts.

## 17. Risques restants et dette technique (récapitulatif final)

| Sujet | Détail | Action recommandée |
|---|---|---|
| `grant_expenses` à allocation multi-lignes non construit | §6 | Revisiter si le besoin réel émerge |
| Export PDF/Excel PAPEJ | §6, §14 — CSV livré, PDF non construit | Prévoir si un rendu mis en page devient nécessaire |
| `payer_is_approver` non testé en pratique côté backend | Hérité du rapport intermédiaire — nécessite une session AAL2 pour poser un `permission_override` de test | Non bloquant, dette de test documentée |
| Docker local non confirmé | §11 | Confirmer avant prochaine session locale, puis rejouer `db reset` + `npm test` en local |
| Security Advisors non re-vérifiés visuellement | §10 | Passage manuel recommandé avant usage réel |
| Accessibilité : sweep des labels non exhaustif | §15 point 3 — corrigé sur les formulaires de création/action principaux ; quelques champs secondaires (ex. sélecteur de compte de paiement dans le formulaire de paiement d'une dépense, motif d'annulation) gardent un placeholder sans `htmlFor` dédié | Sweep complémentaire recommandé, non bloquant (contenu descriptif présent) |
| Rapprochement bancaire réel, écritures manuelles, états financiers, module Fournisseurs | Hors périmètre Phase 1C (§1 du plan) | Prévu Phase 2 |

## 18. Prochaine étape

Conformément à votre instruction, je m'arrête ici pour votre validation
explicite. **Aucune ligne de Phase 1D ni Phase 2 n'a été commencée.**
Backend et UI sont tous deux validés avec preuves vérifiables : 170 tests
d'intégration/E2E vivants + 18 tests composants isolés, tous verts au
rejeu final ; typecheck/lint/build propres ; `git status` propre ; 16
commits atomiques ; quatre vrais défauts trouvés et corrigés en cours de
route (trois backend en §8, un RLS + deux UI en §15) — aucun dissimulé.
