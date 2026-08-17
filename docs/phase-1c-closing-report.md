# Phase 1C — Rapport de clôture

> **⚠️ SEULE SECTION DE STATUT FAISANT FOI : §25.** Ce document a été
> rédigé en plusieurs passes (15, 16 et 17/08/2026). Toute affirmation de
> statut *global* antérieure à §25 — y compris le paragraphe qui suivait
> ici avant le 17/08, les décomptes de tests "170" (§16) et "106" (§9), le
> tableau "240/255 confirmés... rejeu combiné en attente" (§22), la
> mention "PDF non construit" (§6/§17, sections déjà historiques), et
> "Advisors non re-vérifiés" (§10, désormais partiellement caduc) — est
> **remplacée** par §25 et ne doit plus être citée comme état actuel. Ces
> sections restent en place pour leur valeur d'historique/preuve locale
> (ex. le détail des correctifs eux-mêmes reste exact), mais aucune ne
> décrit plus l'état global du projet. §24 ("Prochaine étape") est de même
> remplacée par §25.

Ce document couvre quatre volets, dans l'ordre chronologique où ils ont
été produits : le socle backend (§1-11, 15/08/2026), l'interface Phase
1C-UI (§12-17, 15-16/08/2026), le hardening cloud + export PDF (§19-24,
16/08/2026) et la clôture des trois derniers points exigés avant toute
Phase 1D/2 — hermétisme des fixtures, rejeu complet propre, Advisors
(§25, 17/08/2026).

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
| Export PDF/Excel du rapport PAPEJ | **CSV** (client) et **PDF** (serveur, `pdf-lib`) tous deux livrés (§19) | Conforme — exigence complète |
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
- **Export PAPEJ : CSV (client) ET PDF (serveur), tous deux livrés** (§19).
  Le CSV reste construit côté client à partir des données déjà autorisées ;
  le PDF est généré par un Route Handler dédié qui rejoue la **même** RPC
  `generate_papej_report()` avec les **mêmes** paramètres que l'écran —
  aucune divergence de filtre/donnée possible entre les trois
  représentations (écran, CSV, PDF).
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
visibilité par rôle + 13/13 tests E2E Playwright (§16).

> **Correction (16/08/2026 soir) — SUPERSEDÉE, voir §25** : le total "170
> tests" initialement affirmé ici ne se reconciliait pas arithmétiquement
> (65+10+13+18 = 106, pas 170) — erreur signalée par Jean Alix Pierre.
> §22 avait ensuite produit un tableau à 255 tests mais avec 15/17 puis
> 17/17 E2E confirmés seulement sur des rejeux successifs, jamais en une
> seule passe continue. **§25 contient désormais le décompte définitif
> (255/255, chaque suite verte en une seule passe continue).** Ce
> paragraphe est conservé tel quel pour l'historique ; ne citer ni "106",
> ni "170", ni le "240/255" de §22 — seul §25 fait foi.

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

> **Correction (16/08/2026 soir) — SUPERSEDÉE, voir §25** : ce "170" ne se
> réconciliait pas avec le détail par fichier ni avec §9 (106) — deux
> totaux différents et tous deux faux. §22 avait ensuite produit
> "240/255" (rejeu combiné incomplet, 2 échecs E2E persistants). **§25
> contient le décompte définitif : 255/255, chaque suite verte en une
> seule passe continue.**

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

## 18. Prochaine étape (historique — voir §24 pour la version à jour)

Conformément à votre instruction, je m'arrête ici pour votre validation
explicite. **Aucune ligne de Phase 1D ni Phase 2 n'a été commencée.**
Backend et UI sont tous deux validés avec preuves vérifiables : 170 tests
d'intégration/E2E vivants + 18 tests composants isolés, tous verts au
rejeu final ; typecheck/lint/build propres ; `git status` propre ; 16
commits atomiques ; quatre vrais défauts trouvés et corrigés en cours de
route (trois backend en §8, un RLS + deux UI en §15) — aucun dissimulé.

---

# Addendum — Export PDF PAPEJ et hardening cloud (16/08/2026, soir)

Ce qui suit couvre les trois exigences posées avant clôture finale : export
PDF PAPEJ obligatoire (§19), analyse et correction des exports réels
Security/Performance Advisor que vous avez collés dans le chat (§20),
vérification post-migration complète (§21) et décompte exact et réconcilié
de tous les tests (§22). §23 met à jour la liste de dette technique, §24
remplace §18 comme statut final de ce rapport.

## 19. Export PDF PAPEJ (exigence obligatoire du Prompt Maître)

Le CSV seul (§14, existant depuis la clôture UI) ne couvrait pas
l'exigence "PDF et Excel/CSV". Ajouté :

- **`app/api/papej/[grantId]/rapport-pdf/route.ts`** (Route Handler) —
  appelle **exactement** la même RPC `generate_papej_report(p_grant_id,
  p_period_start, p_period_end)` que l'écran, avec les mêmes paramètres.
  Aucune requête ni calcul parallèle : le PDF ne peut pas diverger de ce
  que l'écran affiche, par construction. Réponses : `400` (paramètres
  manquants/mal formés), `404` (financement introuvable), `403` (RPC
  renvoie `success: false` — permission ou isolation organisationnelle),
  `200` + `application/pdf` sinon.
- **`lib/pdf/papej-report.ts`** (`pdf-lib`, sans dépendance native) — met
  en page la réponse de la RPC : organisation, financement, période,
  montant accordé/reçu/engagé/payé/disponible, utilisation par ligne
  budgétaire (prévu/engagé/payé/disponible + chaque dépense avec
  bénéficiaire/montant/statut/justificatif), dépenses sans justificatif,
  lignes avec engagement ouvert (anomalies et éléments en attente), date
  de génération.
- **`components/finance/papej-report.tsx`** — bouton "Télécharger le PDF"
  utilisant les **mêmes** `period_start`/`period_end` que le rapport déjà
  généré à l'écran (pas les champs de formulaire live, qui pourraient
  avoir changé entre-temps).
- **`tests/e2e/papej-pdf-export.spec.ts`** — 4 tests contre le cloud,
  **4/4 verts** (voir §21) : génération + contenu essentiel (extraction de
  texte réelle du PDF via `pdf-parse`, vérifie organisation, financement,
  les deux dates de période, les 5 libellés financiers, la catégorie de
  ligne, le nom du bénéficiaire, "Genere le", "Depenses sans
  justificatif") ; permission (rôle sans `papej.report` → 403, corps de
  réponse sans fuite du nom d'organisation) ; isolation organisationnelle
  (acteur d'une autre organisation → 403) ; paramètres invalides
  (manquants → 400, date mal formée → 400).

**Deux bugs réels trouvés et corrigés pendant la vérification** (aucun
détectable par relecture de code, seulement par génération réelle d'un PDF
avec un vrai montant) :

1. `Intl.NumberFormat('fr-FR', { style: 'currency', ... })`
   (`lib/format/money.ts`, formatage écran inchangé) insère une **espace
   fine insécable** (U+202F) comme séparateur de milliers. `pdf-lib`
   encode les polices standard en WinAnsi (code page 1252), qui ne
   contient pas ce caractère : `page.drawText()` levait une exception dès
   qu'un montant dépassait 999, faisant échouer la génération (500) pour
   **tout** rapport avec un montant réel. Corrigé par une fonction
   `winAnsiSafe()` locale au module PDF qui neutralise uniquement les
   variantes d'espace non représentables avant chaque `drawText` — jamais
   la logique de formatage ni les données.
2. Le paquet réellement installé (`pdf-parse@2.4.5`, voir `package.json`)
   expose une API classe (`new PDFParse({ data }).getText()`), pas la
   fonction `pdfParse(buffer)` de la v1 que le test appelait initialement
   — vérifié contre `node_modules/pdf-parse/README.md` installé
   réellement, pas contre la documentation générique en ligne. Corrigé
   pour utiliser l'API réelle ; `@types/pdf-parse@^1.1.5` (API v1, sans
   consommateur dans le code puisque l'import se fait par `require()` non
   typé) retiré comme dépendance obsolète.

Commit `88c4ce5`.

## 20. Hardening cloud — Security Advisor (29) et Performance Advisor (74), table de réconciliation complète

Vous avez collé les exports réels du dashboard Supabase (29 avertissements
Security Advisor, 74 avertissements Performance Advisor). Traités comme
la seule source de vérité, pas mon substitut structurel précédent (qui
reste utile comme outillage de vérification continue, voir les fonctions
`debug_*` en §21, mais qui ne remplace pas un vrai passage du Advisor).

### 20.1 — `function_search_path_mutable` (5 avertissements) — tous corrigés

Chaque fonction inspectée individuellement (définition complète, corps,
références) avant correction — pas un `search_path` générique appliqué en
masse :

| Fonction (`app_private.`) | Cause | Analyse individuelle | Correction | Preuve |
|---|---|---|---|---|
| `accounting_periods_immutable_once_closed` | Trigger sans `set search_path` | Ne référence que `OLD`/`NEW`/`TG_OP` (pseudo-variables), aucun objet de schéma | `search_path = ''` (le plus strict possible — toute résolution non qualifiée future échouerait à la compilation plutôt que de risquer un détournement) | `debug_security_definer_without_search_path('app_private')` → vide |
| `journal_entries_immutable_once_posted` | idem | idem (aucune référence de schéma) | `search_path = ''` | idem |
| `journal_entry_lines_immutable_once_posted` | idem | Référence `public.journal_entries`, déjà qualifiée explicitement | `search_path = ''` | idem |
| `enforce_budget_line_org_consistency` | idem | Référence `public.budgets`, déjà qualifiée explicitement | `search_path = ''` | idem |
| `prevent_direct_grant_receipt_change` | idem | Appelle uniquement `current_setting()` (`pg_catalog`, résolu indépendamment du `search_path`) | `search_path = ''` | idem |

Migration `20260816090014_fix_search_path_trigger_functions.sql` —
`CREATE OR REPLACE` strict, corps de fonction et triggers déjà attachés
inchangés, seule la clause `set search_path` ajoutée. **Vérifié en
direct** (pas seulement supposé) : `debug_security_definer_without_search_path()`
interrogé sur `public` ET `app_private` après application → **tableau
vide dans les deux cas** (aucune fonction `SECURITY DEFINER` sans
`search_path` fixe dans tout le projet, pas seulement les 5 corrigées).

### 20.2 — `authenticated_security_definer_function_executable` (23 avertissements) — audit individuel complet

Liste des 23 fonctions confirmée **en direct** contre le schéma
PostgREST réellement exposé (`GET /rest/v1/` avec `Accept:
application/openapi+json`, moins les 5 fonctions `debug_*` réservées à
`service_role`) — pas une reconstruction depuis les fichiers de
migration. Chacune inspectée individuellement contre la grille demandée :
raison du `SECURITY DEFINER`, appel direct par l'app via RPC, permission
métier requise, capture de `auth.uid()`, vérification d'appartenance
organisationnelle, isolation multi-tenant, validation de l'objet cible,
risque IDOR, risque d'élévation de privilège, `search_path`, droits
`EXECUTE`, tests négatifs existants.

**Classification : les 23 sont Catégorie A** (intentionnelles,
correctement sécurisées) — aucune B (à durcir) ni C (accès direct
authenticated non nécessaire, à révoquer). Aucun `REVOKE EXECUTE FROM
authenticated` global appliqué — chaque fonction a été jugée
individuellement, pas par lot.

| Groupe | Fonctions | Pourquoi Catégorie A | Test de preuve |
|---|---|---|---|
| **7 RPC `admin_*`** (administration sensible) | `admin_assign_role`, `admin_create_membership`, `admin_revoke_role`, `admin_set_membership_status`, `admin_set_permission_override`, `admin_set_user_status`, `admin_update_organization_settings` | Chacune : capture `auth.uid()` en tête, vérifie `app_private.has_permission(..., 'user.manage'/'role.manage'/...)` avant toute écriture, dérive l'organisation cible de la ligne visée (jamais d'un paramètre non vérifié — IDOR impossible), refuse l'auto-élévation (`admin_assign_role`/`admin_revoke_role` bloquent la modification de son propre rôle), refuse une cible non membre actif de l'organisation (durcissement audit vérifié explicitement), journalise le refus dans `audit_logs` | `tests/integration/security-definer-audit.test.ts` (18 tests, pré-existant) : anon refusé sur les 9 (voir ligne suivante) + EMPLOYE (authentifié, aucune permission) refusé sur les 7 + contrôle positif (admin autorisé réactive un compte suspendu) + durcissement cible non-membre |
| **2 utilitaires** | `current_user_has_permission`, `next_number` | Lecture/action strictement scopée à l'organisation de l'appelant (`auth.uid()` capturé, jamais un paramètre `p_user_id` arbitraire) ; `next_number` verrouille (`FOR UPDATE`) avant incrémentation, refuse un appelant non membre de l'organisation cible | Même fichier — inclus dans les 9 testés anon-refusés + `tests/integration/numbering.test.ts` (refus explicite pour un non-membre) |
| **14 RPC Phase 1C** | `submit_expense_request`, `approve_expense_request`, `cancel_expense_request`, `pay_expense_request`, `justify_expense_request`, `request_expense_approval_exception`, `validate_expense_approval_exception`, `post_journal_entry`, `reverse_journal_entry`, `commit_budget_line`, `transfer_budget_amount`, `record_grant_receipt`, `create_grant_budget_line`, `generate_papej_report` | Chacune vérifie `app_private.has_permission()` avec le code de permission métier exact, dérive l'organisation de la ligne cible (`expense_requests.organization_id`, `budgets.organization_id`, etc. — jamais d'un paramètre brut), refuse l'auto-approbation/auto-validation (SoD), transitions d'état via RPC uniquement (aucun `UPDATE` direct accordé à `authenticated`) | **Trouvaille du processus d'audit** (pas un défaut — une hypothèse jusque-là non testée explicitement) : aucune de ces 14 n'avait de test "anon explicitement refusé" dédié. Ajouté : `tests/integration/phase1c-anon-refusal.test.ts`, **14/14 verts** — chacune renvoie `42501` (permission denied, EXECUTE absent), jamais une erreur métier qui prouverait une exécution partielle avec les privilèges du propriétaire |

**Preuve structurelle complémentaire** (mécanique, indépendante de
l'inspection au cas par cas) : `debug_unwanted_function_grants('public')`
interrogé en direct après le hardening → **tableau vide** — aucune des 23
fonctions (ni aucune autre du schéma `public`) n'a de privilège `EXECUTE`
accordé à `PUBLIC` ou `anon`. C'est le mécanisme réel qui garantit le
refus anon, pas seulement le comportement observé au cas par cas.

### 20.3 — `auth_leaked_password_protection` (1 avertissement) — indisponible sur le plan Supabase actuel, pas un défaut applicatif

**Correction importante (précision de Jean Alix Pierre) : ce point ne doit
pas être présenté comme une faille de l'application.** "Leaked password
protection" (vérification de chaque mot de passe candidat contre l'API
HaveIBeenPwned, par k-anonymat de préfixe de hash — jamais le mot de
passe en clair transmis) est une **fonctionnalité Supabase Auth
indisponible sur le plan Free** de ce projet — elle ne s'active pas au
niveau du schéma applicatif ni par migration SQL, quel que soit le code
écrit ici. Ce n'est donc ni un bug ni une négligence de Phase 1C : c'est
une limite de palier d'infrastructure, au même titre qu'un quota
d'authentification ou une limite de taille de base sur un plan gratuit.

**Action à prévoir, documentée pour plus tard** (pas pour cette clôture) :
lors du passage du projet Supabase au **plan Pro** (recommandé avant
toute mise en production avec de vrais utilisateurs/données financières
sensibles) :

1. Dashboard Supabase → projet `qwydgqheceglulfxwtgo` → **Authentication**
   → **Providers** (ou **Policies** selon la version du dashboard) →
   section **Password**.
2. Activer **"Leaked password protection"**.
3. Référence :
   `https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection`.

### 20.4 — `auth_rls_initplan` (74 avertissements) — tous corrigés, logique d'autorisation inchangée

**Méthode mécanique, pas une réécriture manuelle policy par policy** (trop
de surface pour rester fiable à la main) :

1. `20260816090015_debug_dump_policies.sql` — `public.debug_dump_all_policies()`,
   réservée `service_role`, dump intégral de `pg_policies` (schema, table,
   policy, permissive, roles, commande, `qual`, `with_check` — le texte
   réel stocké par Postgres, pas une reconstruction depuis les fichiers de
   migration source, qui aurait pu manquer une policy modifiée entre
   plusieurs fichiers — déjà le cas réel une fois avec `budget_lines_select`,
   voir §15).
2. `scripts/dump-policies.mjs` interroge cette fonction et sauvegarde
   l'état réel (79 policies au total dans `public`).
3. `scripts/generate-rls-initplan-fix.mjs` détecte mécaniquement tout
   appel **nu** (non précédé de `select`) à `auth.uid()`/`auth.jwt()`/
   `auth.role()`/`auth.email()` dans `qual`/`with_check`, et génère une
   migration `drop policy ... ; create policy ...` qui **enrobe
   uniquement ces appels** en `(select auth.<fn>())` — reste du texte
   (conditions, jointures, casts) recopié à l'identique, verbatim. Aucune
   transformation manuelle, donc aucun risque d'erreur de recopie.
4. **74 policies sur 79 identifiées comme concernées** — correspond
   exactement aux 74 avertissements Performance Advisor. Les 5 policies
   non concernées (`employee_documents_select`, `expense_attachments_select`,
   `permissions_select`, `role_permissions_select`, `roles_select`)
   délèguent soit à une fonction (`app_private.can_access_*`, dont l'appel
   `auth.uid()` interne n'est pas visible dans le texte de la policy elle-même
   — hors périmètre de cet avertissement précis), soit sont `using (true)`
   (catalogues publics en lecture, aucun appel `auth.*`).
5. `20260816090016_fix_auth_rls_initplan.sql` généré et appliqué. **Vérifié
   en direct après application** : re-dump complet des 79 policies →
   **0 appel nu restant** (79 policies, 79 confirmées avec tout appel
   `auth.*` déjà enrobé en `(select ...)` ou sans appel `auth.*` du tout).

**"Ne jamais changer la logique d'autorisation pour supprimer un
avertissement"** — respecté par construction : la transformation est
purement syntaxique (ajout de `(select ...)` autour d'un appel de
fonction existant, un enrobage sémantiquement neutre reconnu et documenté
par Supabase lui-même comme l'optimisation recommandée — Postgres évalue
alors l'appel une fois par requête, en InitPlan, au lieu d'une fois par
ligne), jamais une modification de condition, de rôle cible, de commande
ou de portée `permissive`/`restrictive`. Chaque `drop`/`create` reproduit
exactement les mêmes conditions, avec les mêmes rôles (`authenticated`
partout — aucune policy `public`/`anon`) et la même commande.

Exemple représentatif (`budget_lines_select`, avant/après) :
```sql
-- avant (avertissement) :
app_private.is_super_admin(auth.uid())
  or app_private.has_permission(auth.uid(), organization_id, 'budget.view')
  ...

-- apres (meme condition, appels enrobes) :
app_private.is_super_admin((select auth.uid()))
  or app_private.has_permission((select auth.uid()), organization_id, 'budget.view')
  ...
```

**Preuve de non-régression de la sécurité** (pas seulement de la
syntaxe) : `tests/integration/expense-creator-visibility.test.ts` (couvre
justement `budget_lines_select`/`budgets_select`, les policies au
périmètre le plus délicat de Phase 1C) rejoué **6/6 vert** après
`090016` — les 5 assertions de visibilité AGENT_TERRAIN + l'isolation
Org B continuent de se comporter exactement pareil. Voir §21 pour la
suite complète.

Liste complète des 74 policies corrigées (table.policy, pour
vérifiabilité — le SQL exact de chacune est dans
`supabase/migrations/20260816090016_fix_auth_rls_initplan.sql`) :

<details>
<summary>74 policies (cliquer pour déplier)</summary>

```
accounting_periods.accounting_periods_close       employees.employees_insert
accounting_periods.accounting_periods_insert      employees.employees_select
accounting_periods.accounting_periods_select      employees.employees_update
audit_logs.audit_logs_select                      expense_approvals.expense_approvals_select
bank_accounts.bank_accounts_insert                expense_attachments.expense_attachments_insert
bank_accounts.bank_accounts_select                expense_categories.expense_categories_select
bank_accounts.bank_accounts_update                expense_categories.expense_categories_update
budget_commitments.budget_commitments_select      expense_categories.expense_categories_write
budget_lines.budget_lines_insert                  expense_requests.expense_requests_insert
budget_lines.budget_lines_select                  expense_requests.expense_requests_select
budget_lines.budget_lines_update                  expenses.expenses_select
budget_transfers.budget_transfers_select          fiscal_years.fiscal_years_insert
budgets.budgets_insert                            fiscal_years.fiscal_years_select
budgets.budgets_select                             fiscal_years.fiscal_years_update
budgets.budgets_update                             grant_budget_lines.grant_budget_lines_select
cash_accounts.cash_accounts_insert                grant_reports.grant_reports_select
cash_accounts.cash_accounts_select                grants.grants_insert
cash_accounts.cash_accounts_update                grants.grants_select
cash_movements.cash_movements_select              grants.grants_update
chart_of_accounts.chart_of_accounts_insert        journal_entries.journal_entries_select
chart_of_accounts.chart_of_accounts_select        journal_entry_lines.journal_entry_lines_select
chart_of_accounts.chart_of_accounts_update        journals.journals_insert
contract_amendments.contract_amendments_insert    journals.journals_select
contract_amendments.contract_amendments_select    journals.journals_update
contracts.contracts_insert                        membership_roles.membership_roles_select
contracts.contracts_select                        memberships.memberships_select
contracts.contracts_update                        mobile_money_accounts.mobile_money_accounts_insert
cost_centers.cost_centers_insert                  mobile_money_accounts.mobile_money_accounts_select
cost_centers.cost_centers_select                  mobile_money_accounts.mobile_money_accounts_update
cost_centers.cost_centers_update                  numbering_sequences.numbering_sequences_select
departments.departments_insert                    organizations.organizations_select
departments.departments_select                    positions.positions_insert
departments.departments_update                    positions.positions_select
employee_documents.employee_documents_insert      positions.positions_update
employee_sensitive_data.employee_sensitive_data_insert   user_permission_overrides.user_permission_overrides_select
employee_sensitive_data.employee_sensitive_data_select   users.users_select
employee_sensitive_data.employee_sensitive_data_update   users.users_update_self
```

</details>

### 20.5 — Table de réconciliation complète (29 + 74 = 103 avertissements)

| Avertissement initial | Nombre | Cause | Décision | Correction/justification | Test de preuve | État final |
|---|---:|---|---|---|---|---|
| `function_search_path_mutable` | 5 | Fonctions trigger `app_private.*` créées sans `set search_path` explicite | Corriger | `search_path = ''` (voir §20.1, analyse individuelle) — migration `090014` | `debug_security_definer_without_search_path()` (public + app_private) → vide | **Corrigé, vérifié en direct** |
| `authenticated_security_definer_function_executable` | 23 | Fonctions `SECURITY DEFINER` exécutables par `authenticated` | Aucune révocation — les 23 sont Catégorie A (intentionnelles, sécurisées) | Audit individuel complet (§20.2) — aucun changement de code, un test manquant ajouté (`phase1c-anon-refusal.test.ts`, 14 tests) | `security-definer-audit.test.ts` (18) + `phase1c-anon-refusal.test.ts` (14) + `debug_unwanted_function_grants('public')` → vide | **Audité, aucune régression, test manquant comblé** |
| `auth_leaked_password_protection` | 1 | Fonctionnalité Supabase Auth **indisponible sur le plan Free** de ce projet — pas un réglage désactivé par erreur | Reporter au passage en plan Pro | Chemin exact documenté (§20.3) pour ce moment-là — **non applicable aujourd'hui**, pas un défaut de l'application | — (à revérifier après upgrade de plan) | **Non corrigible aujourd'hui — limite de palier d'infrastructure, pas une faille** |
| `auth_rls_initplan` | 74 | Policies RLS avec appel `auth.*()` nu (réévalué par ligne) | Corriger — enrobage syntaxique uniquement | `(select auth.<fn>())`, générée mécaniquement depuis l'état réel des policies — migration `090016` (§20.4) | Re-dump des 79 policies → 0 appel nu restant ; `expense-creator-visibility.test.ts` 6/6 (policies les plus sensibles) | **Corrigé, vérifié en direct, logique d'autorisation inchangée** |
| **Total** | **103** | | | | | **102/103 corrigés et vérifiés en direct ; 1/103 (mot de passe compromis) hors de portée sur le plan actuel — pas un défaut de sécurité applicatif** |

**Important — ce que je ne déclare PAS** : je n'ai revu ni les 29 ni les 74
avertissements *dans le dashboard Supabase Studio lui-même* après
correction (aucune session authentifiée disponible depuis cet
environnement). Tout ce tableau repose sur des vérifications
**structurelles directes en base** (les fonctions `debug_*`, réservées
`service_role`, qui interrogent `pg_catalog`/`information_schema`/
`pg_policies` réels) — la preuve la plus proche possible sans accès
dashboard, mais **pas** une confirmation visuelle du Advisor lui-même.
**Je vous demande explicitement de relancer le Security Advisor ET le
Performance Advisor depuis le dashboard et de me partager les nouveaux
exports** — je ne déclarerai les 103 avertissements "disparus" qu'après
cette vérification réelle de votre part.

## 21. Vérification post-migration et limite rencontrée (rate limiting Supabase Auth)

Après application de `090011`-`090016` (via `supabase db push --db-url`,
projet lié le temps de l'opération sur la région `aws-0-us-east-2` du
pooler, jamais découverte auparavant côté outillage de ce projet — notée
ici pour toute session future), la chaîne complète demandée a été
rejouée :

- **`npx tsc --noEmit`** : 0 erreur.
- **`npm run lint`** : 0 erreur, 0 avertissement.
- **`npm run build`** : succès, mêmes 24 routes qu'avant (`/api/papej/[grantId]/rapport-pdf`
  ajoutée par le Route Handler PDF).
- **Tests ciblés sur les policies réécrites** (les plus sensibles,
  rejouées isolément après `090016`) :
  `expense-creator-visibility.test.ts` **6/6**, `phase1c-anon-refusal.test.ts`
  **14/14**, `permission-overrides.test.ts` **5/5**, `numbering.test.ts`
  **3/3**, `privilege-audit.test.ts` **2/2** — tous confirmés verts en
  isolation, avant que le rejeu combiné complet ne rencontre la limite
  décrite ci-dessous.
- **Suite d'intégration complète** (18 fichiers, 177 tests) et **suite E2E
  complète** (7 fichiers, 17 tests) rejouées contre le cloud. Deux vrais
  bugs trouvés et corrigés au passage (aucun lié à `auth_rls_initplan`) :
  1. `tests/integration/numbering.test.ts` supposait une séquence
     `test_entity` repartant toujours de `0001` — mais le projet cloud
     partagé n'est **jamais réinitialisé** entre deux lancements de la
     suite (`SKIP_DB_RESET=1`), donc le compteur avançait à chaque
     exécution réelle (`TST-0007`, puis `TST-0008`...). Corrigé en
     générant un `entity_type` unique par exécution
     (`` `test_entity_${Date.now()}` ``) — la séquence démarre alors
     toujours réellement à `0001`, sans dépendre d'une réinitialisation
     externe.
  2. `tests/integration/permission-overrides.test.ts` ("un override expiré
     n'a plus d'effet") utilisait une marge de 1500ms entre
     `expires_at` (calculé côté client avant l'appel réseau) et
     l'insertion réelle — insuffisant face à la latence réseau de ce
     sandbox, observée jusqu'à **3.7 secondes** sur un seul insert,
     violant la contrainte `CHECK (expires_at is null or expires_at >
     created_at)` côté serveur. Corrigé avec une marge généreuse (10s) et
     une attente **recalculée après coup** à partir de l'`expires_at`
     réellement enregistré (pas d'un total fixe deviné à l'avance) — donc
     correct quelle qu'ait été la latence réelle de l'insertion. Sans
     lien avec RLS : cet insert utilise le client `service_role`, qui
     ignore RLS.
- **Auto-guérison ajoutée à `signInAsElevated()`** (`tests/integration/helpers.ts`) :
  un test interrompu en cours de route (rate limiting en plein test, voir
  ci-dessous) peut laisser un facteur MFA résiduel sur un compte de démo,
  bloquant tout enrôlement futur (`mfa_factor_name_conflict`, 422).
  Nettoyage défensif (liste puis suppression de tout facteur existant)
  avant chaque enrôlement, plutôt qu'une supposition d'état propre.

**Limite réelle rencontrée, honnêtement rapportée** : le volume cumulé de
connexions (`signInWithPassword`) sur l'ensemble de cette session (des
dizaines de rejeux, complets ou ciblés, sur la même journée) a fini par
**épuiser le quota anti-abus de Supabase Auth pour ce projet** —
visiblement un quota par IP source, puisque plusieurs comptes de démo
différents (`comptable`, `dg`, `dt`, `manager`, `employe`, `rh`, `support`,
`agent`, `orgb`, `suspendu`, `super`) ont tous fini par être refusés au
cours du même rejeu combiné, avec le message exact `Request rate limit
reached`. Deux rejeux combinés complets de la suite d'intégration ont
ainsi affiché 45 puis (après un délai et un travail de fond sans appel
Auth) toujours des échecs — mais **tous vérifiés un par un comme étant
exactement ce message, jamais une assertion métier différente** :

```
45 failed | 132 passed (177) — rejeu n°1 (juste apres 090016)
[decompte exact par cause d'echec ci-dessous]
  43 × "Request rate limit reached" (signInAs, tous comptes confondus)
   2 × "A factor with the friendly name... already exists" (consequence
       du rate limiting : cleanup MFA interrompu par le meme phenomene,
       corrige par l'auto-guerison ci-dessus)
```

Le même phénomène a été **rencontré et documenté trois fois déjà** dans
ce projet (Phase 1A, Phase 1B, et la clôture Phase 1C-UI précédente,
§16) — jamais un défaut fonctionnel, toujours résolu par une pause avant
rejeu. Cette fois, le volume cumulé sur une seule longue session a été
significativement plus important, et la fenêtre de rate limiting plus
longue à se dissiper. **Preuve que ce n'est pas un défaut de permission**
apportée indépendamment du rejeu bloqué :

- **Reproduction directe hors navigateur/Vitest**, en contournant le
  compte de démo rate-limité, du flux exact d'un des tests E2E ayant
  échoué pendant le rejeu (`submit_expense_request` en tant que
  `manager.demo`) : insertion du brouillon (187ms), appel RPC
  `submit_expense_request` (209ms, `{ success: true }`), relecture du
  statut (217ms, `submitted`) — **rapide et correct**, confirmant que le
  backend (RLS comprise) fonctionne normalement dès que l'authentification
  elle-même n'est pas bloquée.
- **Suite E2E rejouée deux fois** : un premier passage (13/17 verts, 4
  échecs — 2 timeouts de connexion typiques du rate limiting, 1 dépassement
  de délai d'affichage de statut, 1 échec de navigation dans le tiroir
  mobile) puis un second passage lancé après ce travail de diagnostic
  (résultat en cours au moment de la rédaction — voir la ligne "État
  final" ci-dessous, mise à jour avant la clôture de ce document).
- Les 2 échecs non typés "timeout de connexion" du premier passage E2E
  (double soumission, navigation tiroir mobile) ont chacun été
  individuellement vérifiés comme des symptômes de charge réseau
  temporaire (délai d'affichage/de navigation dépassant le timeout
  Playwright par défaut), pas une régression de logique — reproduction
  directe du flux backend sous-jacent ci-dessus, réponse serveur rapide et
  correcte à chaque étape.

**Recommandation explicite** : ne pas relancer de gros volume de tests
d'intégration contre ce projet cloud dans l'heure suivant cette session,
le temps que le quota se régénère naturellement côté Supabase, avant toute
vérification finale complémentaire.

## 22. Décompte exact des tests — état au 16/08/2026 soir (SUPERSEDÉE, voir §25)

> **Cette section est historique.** Elle documente honnêtement l'état
> intermédiaire du 16/08/2026 soir (240/255 confirmés, rejeu combiné de
> l'intégration jamais bouclé en une seule passe à cause du rate limiting
> Supabase Auth, 2 échecs E2E persistants dont la cause a ensuite été
> corrigée). **Le décompte définitif, avec les 255/255 confirmés en une
> seule passe continue par suite, est en §25.** Conservée pour la
> traçabilité du diagnostic (§21 reste la description exacte du rate
> limiting rencontré et du diagnostic des 2 échecs E2E, toujours valide).

Le "170" de §16 et le "106" de §9 étaient **tous deux faux** : ni l'un ni
l'autre ne se réconcilie avec le détail réel par fichier
(65+10+13+18 = 106, jamais 170 ; et 106 lui-même omettait des fichiers de
tests unitaires bien réels). Tableau ci-dessous construit en comptant
**chaque test individuellement** dans chaque fichier (`--reporter=verbose`,
jamais un total supposé), toutes suites confondues, à l'état actuel du
code (après le hardening de ce document) :

| Suite | Nombre | Détail (fichiers) | Résultat |
| --- | ---: | --- | --- |
| Phase 1A | 62 | `rls-rbac`(17) + `admin-negative`(8) + `mfa-enforcement`(1) + `permission-overrides`(5) + `audit-completeness`(2) + `numbering`(3) + `role-scoping`(8) + `security-definer-audit`(18) | 62/62 confirmés verts individuellement (voir note rate limiting ci-dessus pour le rejeu combiné) |
| Phase 1B | 20 | `hr-workflows`(20) | 20/20 confirmés verts individuellement |
| Phase 1C backend | 65 | `privilege-audit`(2) + `accounting-core`(18) + `treasury`(6) + `budget`(15) + `expenses`(13) + `papej`(11) | 65/65 confirmés verts individuellement (nombre inchangé depuis la clôture backend initiale) |
| Visibilité rôles | 10 | `ui-permissions`(10) | 10/10 confirmés verts individuellement |
| Composants | 18 | `money-format`(8) + `action-form`(3) + `metric-card`(3) + `status-badge`(4) | **18/18 verts**, rejeu unique, aucun appel réseau (jsdom pur) |
| Playwright E2E | 17 | `expense-workflow`(3) + `budget-workflow`(2) + `treasury-workflow`(2) + `papej-workflow`(2) + `mobile-nav`(1) + `errors-empty-states`(3) + `papej-pdf-export`(4, nouveau §19) | 15/17 confirmés sur 2 rejeux combinés consécutifs (13/17 puis 15/17) ; 2 échecs persistants, cause racine identifiée (§21 — accumulation de données de test, pas une régression), correction du nettoyage de fixtures non faite ce soir |
| Autres | 63 | `expense-creator-visibility`(6, §15/§20.4) + `phase1c-anon-refusal`(14, §20.2) + `app-private-grants-static`(34, standard `app_private` sur **toutes** les fonctions du projet — 34 réelles, pas les "19" historiquement citées en §7, chiffre resté figé depuis avant les phases suivantes) + `rbac-catalogue-sync`(3) + `mfa-logic`(6) | 63/63 confirmés verts individuellement |
| **Total** | **255** | 18 fichiers d'intégration (177) + 7 fichiers unitaires (61) + 7 fichiers E2E (17) | **240/255 confirmés verts en rejeu isolé ou par fichier (238 intégration/unitaires + 15/17 E2E confirmés sur 2 rejeux consécutifs, §21) ; le rejeu combiné final de la suite d'intégration (177 dans une seule passe, sans interruption) reste à confirmer après dissipation du rate limiting Supabase Auth ; les 2 derniers échecs E2E ont une cause racine identifiée et documentée (accumulation de données de test, §21/§23), pas une régression** |

**Ce que ce tableau affirme, précisément** : chaque test a été exécuté et
observé vert **au moins une fois** dans cette session, soit lors du rejeu
combiné, soit lors d'un rejeu isolé ciblé déclenché après un échec dû au
rate limiting (jamais après un échec d'assertion métier — aucun test n'a
été "réessayé jusqu'à ce qu'il passe" après un vrai désaccord entre le
résultat attendu et le résultat observé). **Ce que ce tableau n'affirme
pas** : que les 255 passent tous **dans une seule exécution continue,
sans aucune interruption d'authentification** — cette confirmation finale
unique reste explicitement en attente, bloquée par le rate limiting
décrit en §21, pas par un défaut découvert.

**Diagnostic ciblé des 2 échecs E2E persistants** (double soumission,
navigation tiroir mobile — reproduits systématiquement sur 3 rejeux
distincts, donc pas de simples ratés isolés) :

1. **Reproduction directe hors navigateur** du flux backend exact du
   premier (`submit_expense_request` en tant que `manager.demo`, hors
   Playwright) — insertion du brouillon (187ms), appel RPC (209ms,
   `{ success: true }`), relecture du statut (217ms, `submitted`) —
   **rapide et correct**. Le backend (RLS comprise) répond normalement.
2. **Cause racine réelle identifiée par inspection manuelle du
   navigateur** (`/depenses/nouvelle`, compte `manager.demo`) : le menu
   déroulant "Ligne budgétaire" contient **plus de 300 options** —
   l'accumulation de toutes les lignes budgétaires créées par **chaque**
   exécution des suites d'intégration et E2E sur toute la durée de cette
   session (aucune de ces suites ne nettoie ses données après elle,
   hormis quelques `afterAll` ciblés), jamais purgée puisque le projet
   cloud partagé n'est jamais réinitialisé (`SKIP_DB_RESET=1`, §21 plus
   haut). Un `<select>` HTML à 300+ options ralentit mesurablement le
   rendu de la page et les requêtes DOM de Playwright
   (`locator('option', { hasText: category })` doit parcourir la liste
   entière) — largement suffisant pour dépasser occasionnellement les
   timeouts par défaut de Playwright sous charge supplémentaire, sans
   qu'aucune logique d'autorisation ne soit en cause.

**Ce n'est ni un défaut de sécurité ni une régression de `090016`** — une
vraie dette de test découverte pendant cette vérification (ajoutée à
§23) : les fixtures d'intégration/E2E devraient nettoyer leurs données
après elles (`afterAll`) plutôt que de laisser le projet cloud partagé
grossir indéfiniment. Non corrigée ce soir (portée hors du hardening
RLS/PDF demandé), documentée comme dette explicite plutôt que
dissimulée.

## 23. Risques restants et dette technique (état au 16/08/2026 soir — voir §25 pour l'état à jour)

Remplace §17 (conservé pour l'historique) :

| Sujet | Détail | Action recommandée |
|---|---|---|
| `grant_expenses` à allocation multi-lignes non construit | §6 | Revisiter si le besoin réel émerge |
| `auth_leaked_password_protection` non activé | §20.3 — hors de portée technique (réglage dashboard, pas SQL) | **Action manuelle requise de votre part** — chemin exact fourni |
| Confirmation finale unique et propre de la suite complète (255 tests) | §21-22 — bloquée par le rate limiting Supabase Auth cumulé sur cette session, pas par un défaut ; chaque test confirmé vert individuellement | ✅ **RÉSOLU le 17/08/2026, voir §25** — rejeu de chaque suite en une seule passe continue, 255/255 |
| **Nouvelle dette découverte ce soir** : les fixtures d'intégration/E2E ne nettoient pas systématiquement leurs données (`afterAll` incomplet) — plus de 300 lignes budgétaires accumulées dans l'organisation de démo partagée sur la durée de cette session, ralentissant mesurablement les pages avec un grand menu déroulant (`/depenses/nouvelle`) et provoquant 2 échecs E2E persistants (§21) | Cause racine confirmée par inspection manuelle (backend rapide et correct, dropdown HTML à 300+ options) — pas une régression de sécurité | ✅ **RÉSOLU le 17/08/2026, voir §25** — mécanisme d'hermétisme (`FixtureRegistry`) + nettoyage rétroactif des fixtures historiques |
| Relance manuelle des Security/Performance Advisors par vous | §20.5 | **Toujours en attente — voir §25**, seul point encore bloquant |
| `payer_is_approver` non testé en pratique côté backend | Hérité du rapport intermédiaire — nécessite une session AAL2 pour poser un `permission_override` de test | Non bloquant, dette de test documentée |
| Docker local non confirmé | §11 | Confirmer avant prochaine session locale, puis rejouer `db reset` + `npm test` en local |
| Accessibilité : sweep des labels non exhaustif | §15 point 3 — corrigé sur les formulaires de création/action principaux ; quelques champs secondaires gardent un placeholder sans `htmlFor` dédié | Sweep complémentaire recommandé, non bloquant (contenu descriptif présent) |
| Rapprochement bancaire réel, écritures manuelles, états financiers, module Fournisseurs | Hors périmètre Phase 1C (§1 du plan) | Prévu Phase 2 |

Aucune dette ci-dessus ne masque un défaut de permission ou de sécurité :
les deux seules dettes réellement nouvelles issues du hardening (le
réglage mot de passe compromis, la confirmation finale unique bloquée par
le rate limiting) sont l'une une action humaine hors de ma portée
technique, l'autre une limite d'infrastructure de test déjà rencontrée et
documentée trois fois dans ce projet — ni l'une ni l'autre ne cache un
écart d'autorisation non testé.

## 24. Prochaine étape (16/08/2026 soir — SUPERSEDÉE, voir §25)

> Cette section décrivait l'état au 16/08/2026 soir, avant que les points
> 1 et 2 ci-dessous ne soient traités le 17/08/2026. **§25 est l'état à
> jour.** Conservée telle quelle pour l'historique.

**Statut (historique) : VALIDÉE FONCTIONNELLEMENT — CLÔTURE FINALE EN
ATTENTE DE VOUS SUR DEUX POINTS PRÉCIS**, comme annoncé en tête de ce
document :

1. **Activer manuellement "Leaked password protection"** dans le
   dashboard Supabase (§20.3) — la seule action que je ne peux pas
   accomplir moi-même.
2. **Relancer le Security Advisor ET le Performance Advisor** depuis le
   dashboard et partager les nouveaux exports, pour confirmation
   indépendante que les 102 avertissements corrigés (§20.5) ont
   effectivement disparu — je ne le déclare pas moi-même sans cette
   vérification réelle de votre part.

De mon côté, **tout ce qui était techniquement possible sans accès
dashboard a été fait et vérifié en direct contre la base cloud réelle** :
export PDF PAPEJ (§19, 4/4 tests), les 5 `function_search_path_mutable`
corrigés, les 23 fonctions `SECURITY DEFINER` auditées individuellement
sans révocation aveugle, les 74 `auth_rls_initplan` corrigés sans
modification de la logique d'autorisation, trois vrais bugs de test
trouvés et corrigés ou diagnostiqués en cours de route (§21 — deux
corrigés, un troisième identifié comme dette de nettoyage de fixtures,
documenté en §23), 255 tests recensés et réconciliés (§22, 240 confirmés
verts individuellement, confirmation finale combinée de l'intégration en
attente de la dissipation du rate limiting), typecheck/lint/build
propres, `git status` propre après commit.

**Aucune ligne de Phase 1D ni Phase 2 n'a été commencée.** Je m'arrête ici
pour votre validation explicite des deux points ci-dessus avant de
déclarer Phase 1C totalement close.

---

# 25. STATUT FINAL CONSOLIDÉ (17/08/2026) — SEULE SECTION DE STATUT FAISANT FOI

Cette section répond point par point aux trois conditions posées avant
toute Phase 1D/Phase 2 : hermétisme des fixtures (corriger, pas
documenter), rejeu complet propre en une seule passe par suite, et
attente de votre rejeu manuel des Advisors. **Elle remplace toute
affirmation de statut global des sections précédentes** (§9, §16, §18,
§20.5 conclusion, §22, §23, §24 — chacune annotée d'un renvoi ici).

## 25.1 — Point 1 : hermétisme des fixtures — RÉSOLU (corrigé, pas documenté)

**Mécanisme** (`tests/support/fixture-registry.ts`, framework-agnostic,
partagé Vitest/Playwright) :

- `TEST_FIXTURE_MARKER = '[TEST-FIXTURE]'` / `tag(label)` — marque non
  ambiguë apposée sur tout champ texte identifiant créé par un test,
  distinguable à l'œil nu (dashboard, PDF, CSV) d'une donnée réelle.
- `FixtureRegistry.track()/trackMany()` — enregistré **immédiatement**
  après chaque insertion réussie, avant toute assertion pouvant échouer :
  même si un test s'arrête en erreur en cours de route, tout ce qui a
  réellement été créé jusque-là reste suivi.
- `trackDerivedFrom()` — pour les lignes créées **indirectement** par une
  RPC de workflow (`budget_commitments`, `budget_transfers`,
  `cash_movements`, `journal_entries`...), interrogées uniquement par les
  identifiants que le test a lui-même déjà créés — jamais une recherche
  large.
- `cleanup()` — suppression dans l'ordre **strictement inverse** de la
  création (correct vis-à-vis des FK par construction, un enfant est
  toujours créé après son parent), par lots groupés par table pour rester
  sous le `hookTimeout`, best-effort par lot (un échec de nettoyage ne
  fait jamais échouer le test lui-même). Appelé depuis `afterAll`
  (intégration) ou `finally` (E2E) — jamais conditionnellement au succès
  du test.
- **Aucune suppression heuristique ni par ancienneté, jamais de purge
  globale de l'organisation réelle** — respecté par construction : le
  registre ne connaît que les identifiants exacts que CE test a
  lui-même créés ou dérivés.

**Retrofit complet** : `tests/e2e/fixtures.ts` + 6 specs E2E
(`budget-workflow`, `expense-workflow`, `errors-empty-states`,
`papej-workflow`, `papej-pdf-export`, plus `treasury-workflow`/
`mobile-nav` qui ne créent aucune fixture) + 5 fichiers d'intégration
(`accounting-core`, `budget`, `expense-creator-visibility`, `expenses`,
`papej`).

**Nettoyage rétroactif** (`scripts/cleanup-legacy-test-fixtures.mjs`,
`--dry-run` supporté) : correspondance **exacte** de préfixes littéraux
dérivés du code source des tests (`fiscal_years.label LIKE 'E2E-%'`,
`'BUD-%'`, `'PAPEJ-%'`, etc.), scopée aux seules organisations de
démo (Org A/B), suppression en ordre FK-safe. **1728+ lignes supprimées,
`budget_lines` 356→0.** Limite structurelle rencontrée et documentée, pas
une dette : une fois une écriture comptable `posted`, elle (et le plan
comptable/les périodes qu'elle référence) est **immuable même via
`service_role`** — vérifié explicitement par les tests
d'`accounting-core.test.ts` eux-mêmes. Le reliquat non supprimable
(~64 `fiscal_years`, ~600+ `chart_of_accounts`) est cette garantie
d'intégrité comptable, pas un oubli de nettoyage.

**Bug auto-infligé trouvé et corrigé pendant ce travail** : le marqueur
initial utilisait des crochets Unicode (`⟦⟧`, U+27E6/27E7), hors de
l'encodage WinAnsi utilisé par `pdf-lib` — faisait planter (500) toute
génération de PDF PAPEJ pour un financement tagué. Corrigé par un
marqueur ASCII (`[TEST-FIXTURE]`) + durcissement générique de
`winAnsiSafe()` dans `lib/pdf/papej-report.ts` (défense en profondeur
pour tout caractère hors WinAnsi, y compris une saisie utilisateur
réelle future).

Commits : `aa2a171` (mécanisme + retrofit + nettoyage rétroactif),
`79322f1` (marqueur ASCII + `winAnsiSafe`), `85456f0` (marge de timeout
E2E alignée, trouvée pendant la reconfirmation — voir §25.2).

## 25.2 — Point 2 : rejeu complet, une seule passe continue par suite — RÉSOLU

Exigence explicite : *"Je ne veux plus une combinaison de « vert
individuellement » + « échec en exécution groupée »."* Chaque suite
ci-dessous a été rejouée **dans une seule commande, sans interruption,
sans rejeu partiel** :

| Suite | Commande | Résultat | Détail |
|---|---|---:|---|
| Unitaire | `npx vitest run tests/unit` | **61/61** | 7 fichiers, 27.4s, aucun appel réseau |
| Intégration | `npx vitest run tests/integration` | **177/177** | 18 fichiers, une seule passe continue, 525.98s |
| E2E Playwright | `npx playwright test --reporter=list` | **17/17** | 7 fichiers (dont `mobile-nav` en projet séparé), une seule passe isolée (aucun process Vitest concurrent), 3.5min |
| **Total** | | **255/255** | Aucun échec, aucune combinaison "vert isolé / rouge groupé" |

La première tentative de rejeu de l'intégration après le hardening
`auth_rls_initplan` avait été interrompue par un incident réseau
transitoire (`TypeError: fetch failed`, cascade sur 16/18 fichiers) —
confirmé transitoire par un test de connectivité direct (`curl`, réponse
normale quelques instants plus tard), pas une régression ; le rejeu
suivant a été **complet et propre du premier coup**.

Chaîne de vérification complémentaire, un seul passage final après tous
les correctifs de ce document :

```bash
npx tsc --noEmit     # 0 erreur
npm run lint          # 0 erreur, 0 avertissement
npm run build          # succes, 24 routes (identique a §21)
git grep eyJhbGci       # 0 resultat reel (2 occurrences : mentions
                          #   descriptives dans ce rapport et phase-1a,
                          #   deja connues comme faux positifs, pas des
                          #   cles)
git grep SUPABASE_SERVICE_ROLE_KEY   # 0 cle en clair, uniquement des
                                        #   noms de variable/placeholders
git status              # propre — tous les commits de ce hardening deja
                          #   atomiques (aa2a171, 79322f1, 85456f0)
```

La dette "plus de 300 lignes budgétaires accumulées" (§21-23) est donc
**résolue à la fois par construction** (le mécanisme d'hermétisme
empêche toute réaccumulation future) **et rétroactivement** (nettoyage
des fixtures historiques déjà exécuté, §25.1).

## 25.3 — Point 3 : Advisors — EN ATTENTE DE VOUS (statut inchangé)

**Ceci reste le seul point bloquant la clôture définitive de Phase 1C.**
Rien de nouveau ici depuis §20.5/§24 : j'attends toujours, de votre part :

1. **Activation manuelle de "Leaked Password Protection"** dans le
   dashboard Supabase (Authentication → Providers/Policies → Password).
   **Précision importante, déjà actée suite à votre remarque** : ceci
   n'est **pas une faille de l'application MedFinder Gestion**. C'est une
   fonctionnalité de Supabase Auth **indisponible sur le plan Free** de
   ce projet — aucun code ni migration SQL ne peut l'activer depuis cet
   environnement, quel que soit l'effort. Elle doit être activée **au
   moment du passage au plan Pro**, avant toute mise en production
   exposant des données financières sensibles à de vrais utilisateurs
   (détail et lien de documentation exact en §20.3, inchangé).
2. **Relance manuelle du Security Advisor ET du Performance Advisor**
   depuis le dashboard, et partage des nouveaux exports — pour
   confirmation indépendante que les 102 avertissements corrigés (tableau
   de réconciliation exact en §20.5) ont effectivement disparu.

**Je ne déclare pas — et ne déclarerai pas — les 102 avertissements
"disparus" avant cette confirmation réelle de votre part.** Tout ce qui
était vérifiable sans accès dashboard authentifié a été vérifié en
direct contre la base cloud réelle (fonctions `debug_*`, voir §20.1/§20.2/
§20.4) ; ce n'est pas un substitut à votre propre relance du Advisor.

## 25.4 — Synthèse

| Condition posée avant Phase 1D/2 | Statut |
|---|---|
| 1. Hermétisme des fixtures (corrigé, pas documenté) | ✅ **Résolu** — §25.1 |
| 2. Rejeu complet, une seule passe continue, environnement propre, 255/255 | ✅ **Résolu** — §25.2 |
| 3. Rejeu manuel des Advisors par vous, confirmation des 102 avertissements | ⏳ **En attente de vous** — §25.3 |

**Phase 1C reste ouverte.** Les points 1 et 2 sont clos de mon côté avec
preuve vérifiable ; le point 3 dépend d'une action que je ne peux pas
accomplir moi-même. **Aucune ligne de Phase 1D ni de Phase 2 n'a été
commencée** et ne le sera pas avant votre confirmation explicite sur ce
dernier point.
