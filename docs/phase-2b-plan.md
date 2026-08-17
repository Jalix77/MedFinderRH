# Phase 2B — États financiers — Plan proposé

Statut : **PROPOSITION EN ATTENTE DE VALIDATION — AUCUNE IMPLÉMENTATION
COMMENCÉE.** Rédigé après clôture de Phase 2A (approuvée le 17/08/2026)
et votre exigence explicite pour 2B : les chiffres doivent être dérivés
**exclusivement** des écritures comptables postées, jamais directement
des modules métier ; chaque état doit se réconcilier avec la balance
générale, testé automatiquement, pas vérifié visuellement. Ce document
répond point par point à votre liste (périmètre, états, vues/RPC,
règles de calcul, contrôles multi-org, permissions, filtres, exports,
tests, risques).

## 1. Périmètre exact

**Dans le périmètre** : 6 états financiers en **lecture seule**,
générés à la demande, jamais stockés — journal général, grand livre,
balance générale, compte de résultat, bilan, flux de trésorerie.

**Hors périmètre 2B** (confirmé par votre message, réservé à 2C-2F ou
au-delà) : aucune nouvelle table de données métier, aucune saisie,
aucune clôture d'exercice formelle (génération d'écritures de clôture
qui virerait le résultat vers les capitaux propres — 2B **calcule** le
résultat non clôturé à la volée, il ne le comptabilise pas), pas de
balance auxiliaire clients/fournisseurs (nécessite 2C, non construit).

## 2. États à livrer (6)

| État | Contenu | Source exclusive |
|---|---|---|
| **Journal général** | Liste chronologique de toutes les écritures postées de la période, avec leurs lignes | `journal_entries` (`status='posted'`) + `journal_entry_lines` |
| **Grand livre** | Mouvements par compte (débit/crédit/solde courant), un compte ou tous | `journal_entry_lines` jointes à `journal_entries` postées |
| **Balance générale** | Total débit/crédit/solde par compte sur la période — **la référence à laquelle tous les autres états se réconcilient** | idem |
| **Compte de résultat** | Revenus − Charges = Résultat net de la période | Comptes `type IN ('revenue','expense')` |
| **Bilan** | Actif = Passif + Capitaux propres (statutaires + résultat non clôturé) | Comptes `type IN ('asset','liability','equity')` + résultat calculé (§4) |
| **Flux de trésorerie** | Mouvements des seuls comptes de trésorerie réels | `journal_entry_lines` filtrées aux comptes liés à `cash_accounts`/`bank_accounts`/`mobile_money_accounts` (§3, **corrigé** par rapport au premier brouillon de `docs/phase-2-plan.md`) |

**Toutes les écritures non postées (`draft`/`submitted`/`approved`/
`rejected`) sont exclues sans exception.** Une contre-passation
(`reversed_entry_id` renseigné) reste une écriture `posted` normale —
incluse comme n'importe quelle autre, son effet s'annule naturellement
dans les totaux, aucun traitement spécial.

## 3. Vues/RPC prévues

**Choix de conception : RPC (fonctions retournant du JSON), pas des
vues SQL brutes** — contrairement au premier brouillon de
`docs/phase-2-plan.md`. Raison : chaque état a besoin d'une plage de
dates paramétrable (période unique ou exercice complet), d'une
conversion de devise cohérente, et d'une logique de signe par type de
compte (actif/charge = solde normal débiteur, passif/capitaux propres/
revenu = solde normal créditeur) — un calcul, pas une simple lecture
filtrée. Même patron déjà prouvé par `generate_papej_report` (RPC
paramétrée, jamais une vue), pas une nouveauté architecturale.

Chaque RPC est `security definer`, revérifie `accounting.view` en
interne (comme `generate_papej_report` revérifie `papej.report`) —
RLS reste la garde de fond sur les tables sous-jacentes, la RPC ajoute
la vérification explicite + l'agrégation :

1. **`generate_general_journal_report(p_org_id, p_period_start, p_period_end, p_journal_code default null)`**
   → lignes chronologiques + total débit/crédit de contrôle.
2. **`generate_general_ledger_report(p_org_id, p_period_start, p_period_end, p_account_id default null)`**
   → si `p_account_id` fourni : mouvements d'un seul compte + solde
   courant ligne par ligne ; sinon, tous les comptes actifs avec solde
   de fin de période chacun.
3. **`generate_trial_balance_report(p_org_id, p_period_start, p_period_end)`**
   → par compte : `total_debit`, `total_credit`, `solde` (signé selon
   le type), plus `total_debit_global`/`total_credit_global` retournés
   explicitly pour un contrôle immédiat côté appelant.
4. **`generate_income_statement_report(p_org_id, p_period_start, p_period_end, p_cost_center_id default null)`**
   → revenus détaillés, charges détaillées, `resultat_net`.
5. **`generate_balance_sheet_report(p_org_id, p_fiscal_year_id, p_as_of_date)`**
   → actifs détaillés, passifs détaillés, capitaux propres statutaires
   détaillés, **`resultat_non_cloture`** (calculé en interne en
   rappelant la même logique que l'état n°4, du début de l'exercice
   à `p_as_of_date` — jamais une nouvelle formule dupliquée),
   `total_actif`, `total_passif_et_capitaux`.
6. **`generate_cash_flow_report(p_org_id, p_period_start, p_period_end)`**
   → mouvements des comptes de trésorerie réels
   (`chart_of_accounts.id IN (select gl_account_id from cash_accounts
   union select gl_account_id from bank_accounts union select
   gl_account_id from mobile_money_accounts)` — **jamais un code de
   compte codé en dur**, pour rester correct même si le comptable crée
   d'autres comptes de trésorerie), entrées/sorties, solde net.

**Aucune nouvelle table.** Migration unique attendue :
`20260823090001_financial_statement_reports.sql`.

## 4. Règles de calcul

- **Signe par type de compte** (convention comptable standard,
  appliquée uniformément dans les 6 RPC, jamais réimplémentée
  différemment d'une RPC à l'autre — factorisée dans une fonction
  interne partagée `app_private.account_normal_balance(p_type text)`) :
  `asset`/`expense` → solde normal **débiteur** (`debit - credit`) ;
  `liability`/`equity`/`revenue` → solde normal **créditeur**
  (`credit - debit`).
- **Résultat net** = `Σ(credit − debit)` des comptes `revenue` −
  `Σ(debit − credit)` des comptes `expense`, sur la plage de dates
  demandée. Calculé une seule fois (fonction interne partagée),
  jamais recalculé séparément par le bilan et le compte de résultat.
- **Bilan non clôturé** : `Total Actif = Total Passif + Total Capitaux
  Propres statutaires (comptes réellement postés, ex. 3000/3900) +
  Résultat non clôturé de l'exercice en cours`. C'est l'identité
  comptable fondamentale — elle est **mathématiquement garantie** par
  l'invariant `debit = credit` déjà vérifié à chaque posting depuis
  1C.1 (`app_private.post_journal_entry`) : la somme signée de tous
  les comptes de toutes les écritures postées est structurellement
  nulle. Le test de réconciliation (§8) ne vérifie donc pas que le
  grand livre "s'équilibre par chance", mais que **l'agrégation par
  type dans chaque RPC est correcte** — c'est la vraie surface de
  risque de 2B, pas l'intégrité des écritures elles-mêmes (déjà
  prouvée).
- **Devise** : présentation par défaut convertie en HTG au
  `exchange_rate_to_htg` **enregistré sur chaque ligne au moment de la
  saisie** — jamais recalculé au taux courant (ADR-006, déjà en
  vigueur). Un paramètre optionnel `p_currency` restreint aux lignes
  d'une devise d'origine donnée, sans conversion, pour un contrôle
  d'audit ponctuel.
- **Centre de coût** : lignes sans `cost_center_id` affichées sous une
  catégorie explicite "Non affecté" — jamais silencieusement exclues
  d'un filtre par centre de coût.
- **Comptes désactivés** (`is_active=false`) : **jamais filtrés** dans
  les états — un compte désactivé aujourd'hui a pu avoir des
  mouvements réels dans le passé, qui doivent rester visibles dans
  l'historique. `is_active` ne gouverne que la saisie future
  (`post_journal_entry` le vérifie déjà, comportement inchangé), jamais
  la lecture d'un état.

## 5. Contrôles multi-organisation

Chaque RPC prend `p_org_id` explicite et revérifie `accounting.view`
sur cette organisation avant tout calcul (même patron
`is_super_admin() OR has_permission(actor, p_org_id, 'accounting.view')`
que toutes les RPC existantes) — **jamais une agrégation qui
traverserait silencieusement plusieurs organisations**. Toutes les
requêtes internes filtrent explicitement `organization_id = p_org_id`
sur `journal_entries`/`journal_entry_lines`/`chart_of_accounts`, en plus
de la RLS déjà active sur ces tables (défense en profondeur, même
discipline que `generate_papej_report`). Isolation testée explicitement
(§8) : un acteur d'Org B ne peut générer aucun des 6 états pour Org A.

## 6. Permissions

**Aucune nouvelle permission catalogue.** `accounting.view` (déjà
seedée depuis la Phase 1A, déjà accordée à SUPER_ADMIN/COMPTABLE, et à
DIRECTEUR_GENERAL une fois AAL2 vérifié) couvre l'intégralité des 6
états — cohérent avec la décision déjà actée en 2A de ne jamais créer
de permission artificielle quand l'existante suffit.

## 7. Filtres

| Filtre | États concernés | Détail |
|---|---|---|
| **Période** (un mois, `accounting_periods`) | Tous | Correspond à `p_period_start`/`p_period_end` d'un seul mois |
| **Exercice** (`fiscal_years`) | Tous | Agrège sur toutes les périodes de l'exercice, ouvertes ou fermées — la clôture d'une période bloque l'écriture, jamais la lecture |
| **Devise** | Tous (optionnel) | HTG converti par défaut ; devise d'origine sur demande, sans conversion |
| **Centre de coût** | Grand livre, compte de résultat | Optionnel — "Non affecté" si absent, jamais masqué |
| **Compte unique** | Grand livre | Optionnel — vue détaillée d'un seul compte |
| **Journal** | Journal général | Optionnel — un seul journal (ex. `CASH` seul) |

## 8. Exports

**CSV côté client**, même patron déjà en place pour PAPEJ (données déjà
autorisées par la RPC, mise en forme uniquement — jamais un second
calcul indépendant). **Export PDF différé** sauf si vous le demandez
explicitement (même discipline qu'en 2A/1C : ne pas construire un
scope non demandé).

## 9. Plan de tests

**Par état** (même discipline que `papej.test.ts`/`accounting-core.test.ts`) :
exactitude arithmétique contre des écritures de test connues
(montants choisis à la main, résultat attendu calculé indépendamment
avant d'écrire l'assertion — jamais "ce que la fonction retourne est
supposé correct"), exclusion stricte des écritures non postées, prise
en compte correcte d'une contre-passation, isolation multi-organisation
pour chacune des 6 RPC, permission `accounting.view` requise.

**Réconciliation inter-états — exigence explicite de Jean Alix Pierre,
testée automatiquement, jamais visuellement** (`tests/integration/financial-statements-reconciliation.test.ts`,
nouveau fichier dédié) :
1. Fixture unique : un jeu d'écritures couvrant les 5 types de comptes
   (actif, passif, capitaux propres, revenu, charge) + au moins une
   contre-passation, montants choisis pour un résultat non trivial
   (éviter les coïncidences à zéro qui masqueraient une vraie erreur
   de signe).
2. **Journal général** : total débit affiché = total crédit affiché.
3. **Grand livre ↔ balance générale** : le solde de fin de période de
   chaque compte dans le grand livre est exactement égal au `solde` de
   ce même compte dans la balance générale.
4. **Balance générale** : `Σ total_debit` (tous comptes) = `Σ total_credit`
   (tous comptes).
5. **Compte de résultat ↔ balance générale** : `resultat_net` =
   `Σ solde` des comptes `revenue` (balance générale) −
   `Σ solde` des comptes `expense` (balance générale).
6. **Bilan** : `total_actif` = `total_passif_et_capitaux` (incluant le
   résultat non clôturé) — **l'invariant central explicitement exigé**.
7. **Flux de trésorerie ↔ grand livre** : le mouvement net des comptes
   de trésorerie dans le flux de trésorerie = le mouvement net de ces
   mêmes comptes dans le grand livre sur la même période.
8. Rejeu avec une **contre-passation** incluse dans la fixture : tous
   les invariants ci-dessus continuent de tenir (preuve que l'inclusion
   normale d'une contre-passation, sans traitement spécial, ne casse
   rien).
9. Isolation multi-org sur les 6 RPC (Org B ne génère rien pour Org A).
10. **Rejeu en une seule passe continue avant toute clôture** — même
    exigence que 2A, pas de rattrapage final.

## 10. Risques d'incohérence comptable

| Risque | Impact | Mitigation |
|---|---|---|
| Signe par type de compte dupliqué/divergent entre les 6 RPC | Deux états afficheraient des chiffres différents pour la même réalité | Fonction interne unique `app_private.account_normal_balance()`, jamais réimplémentée par RPC |
| Écriture non postée incluse par erreur (filtre `status` oublié) | Un brouillon ou une écriture rejetée fausserait un état | Filtre `status = 'posted'` explicite et testé dans chacune des 6 RPC (§9 point 1-2 le détecterait immédiatement via la réconciliation) |
| Conversion de devise recalculée au lieu de figée | Deux lectures du même état à des moments différents donneraient des totaux différents | `exchange_rate_to_htg` toujours lu depuis la ligne, jamais recalculé (ADR-006 déjà en vigueur, juste réaffirmé ici) |
| Comptes de trésorerie identifiés par code compte codé en dur | Un nouveau compte de trésorerie créé par le comptable serait invisible du flux de trésorerie | Identification par `gl_account_id` réel (`cash_accounts`/`bank_accounts`/`mobile_money_accounts`), jamais par code (§3) |
| Centre de coût null traité comme "exclu" plutôt que "non affecté" | Sous-total par centre de coût ne totaliserait pas le montant global | Catégorie explicite "Non affecté", jamais un filtre silencieux |
| Résultat non clôturé recalculé différemment par le bilan et le compte de résultat | Bilan déséquilibré sans raison métier réelle | Le bilan **rappelle** la RPC du compte de résultat en interne, ne réimplémente jamais la formule |

## 11. Critères de clôture (même discipline que 2A)

Migration appliquée et vérifiée ; RLS/RBAC testées (positif/négatif,
isolation multi-org) ; les 10 invariants de réconciliation (§9) verts en
une seule passe continue ; typecheck/lint/build propres ; scan secrets
propre ; `git status` propre ; **Advisors** — pas de nouvelle vérification
cloud attendue (aucune nouvelle table, seulement des RPC `SECURITY DEFINER`
suivant exactement le patron déjà audité en Phase 1C/2A — recontrôle
structurel via `debug_security_definer_without_search_path`/
`debug_unwanted_function_grants` avant clôture, comme en 2A) ; rapport de
clôture `docs/phase-2b-closing-report.md` ; puis arrêt pour validation
avant 2C.

---

**Aucune ligne de code, migration ou test n'a été écrite pour Phase 2B.**
Je m'arrête ici pour votre validation du périmètre et de la conception
ci-dessus avant d'écrire quoi que ce soit.
