# Phase 2B — États financiers — Rapport de clôture complet

Statut : **EN ATTENTE DE VOTRE VALIDATION EXPLICITE** avant tout début
de Phase 2C. Aucune ligne de Phase 2C n'a été commencée.

---

## 1. Fonctionnalités réellement livrées

- Six états financiers dérivés **exclusivement** de `journal_entries`/
  `journal_entry_lines` **comptabilisées** (statut `posted`) — jamais des
  modules métier (Dépenses, PAPEJ, facturation, `cash_movements`)
  directement.
- Écran `/comptabilite/rapports` : sélecteur d'état, filtres par état
  (période, exercice/date, journal, centre de coût), tableau + synthèse
  de contrôle affichés à l'écran.
- Export **PDF** par état (`app/api/comptabilite/rapports`) et export
  **CSV** (client), tous deux construits à partir de **la même réponse
  RPC** que l'écran — aucune divergence possible entre les trois
  représentations.
- Lien "États financiers" ajouté sur `/comptabilite`.

## 2. Migrations

| Fichier | Contenu |
|---|---|
| `20260823090001_financial_statement_reports.sql` | colonne `chart_of_accounts.cash_flow_category` (+ seed de classification) ; 3 fonctions internes ; 6 RPC publiques |
| `20260823090002_fix_balance_sheet_unaffected_result_scope.sql` | correctif du défaut n°1 (§9) |

Les deux ont été appliquées par vous via l'éditeur SQL Supabase et
confirmées ("done ?" / "success"). **Aucune nouvelle table, aucune
nouvelle policy RLS, aucun nouvel index** — vérifié explicitement :
`grep` des deux fichiers pour `create table`/`create policy`/`create
index` retourne zéro occurrence.

## 3. RPC / vues

Aucune vue — 6 RPC publiques (`security definer`, `search_path` fixe,
`revoke all from public` + `grant execute to authenticated` uniquement) +
3 fonctions internes partagées en `app_private` :

| RPC publique | Paramètres |
|---|---|
| `generate_general_journal_report` | `p_org_id, p_period_start, p_period_end, p_journal_code?` |
| `generate_general_ledger_report` | `p_org_id, p_period_start, p_period_end, p_account_id?` |
| `generate_trial_balance_report` | `p_org_id, p_period_start, p_period_end` |
| `generate_income_statement_report` | `p_org_id, p_period_start, p_period_end, p_cost_center_id?` |
| `generate_balance_sheet_report` | `p_org_id, p_fiscal_year_id, p_as_of_date` |
| `generate_cash_flow_report` | `p_org_id, p_period_start, p_period_end` |

Fonctions internes partagées (jamais dupliquées par RPC) :
`app_private.account_normal_balance_sign(p_type)`,
`app_private.compute_income_statement(...)` (réutilisée par le compte de
résultat **et** par le bilan pour le résultat non affecté),
`app_private.compute_accounts_balance_as_of(...)` (réutilisée par le
grand livre, la balance générale et le flux de trésorerie).

Chaque RPC : org dérivée du contexte authentifié (jamais un paramètre
client de confiance), vérifie `is_super_admin(auth.uid()) OR
has_permission(auth.uid(), p_org_id, 'accounting.view')`, retourne
`{success:false, error:'not_authorized'}` en cas de refus (jamais une
exception, pour préserver la traçabilité "denied" déjà établie depuis la
Phase 1A) — jamais `service_role` exposé côté client.

## 4. États financiers disponibles

1. **Journal général** — toutes les lignes d'écritures postées sur la
   période, colonnes : période, journal, numéro, date, référence,
   libellé, compte, débit, crédit, source métier, centre de coût.
2. **Grand livre** — par compte : solde d'ouverture, mouvements débit/
   crédit période, solde de clôture.
3. **Balance générale** — par compte : solde ouverture / débit période /
   crédit période / solde clôture.
4. **Compte de résultat** — Produits, Charges, Résultat net, sur une
   période donnée.
5. **Bilan** — Actif, Passif, Capitaux Propres, Résultat de l'exercice
   non affecté, à une date donnée (`as_of_date`).
6. **Flux de trésorerie** (méthode directe, explicitement indiquée) —
   Exploitation / Investissement / Financement / Non classifié /
   Virements internes, trésorerie d'ouverture et de clôture.

## 5. Règles de calcul

- **Source unique** : uniquement les lignes de `journal_entry_lines`
  dont l'écriture parente a `status = 'posted'`. Jamais une agrégation
  directe des tables métier.
- **Solde d'ouverture** (grand livre, balance générale, trésorerie) :
  somme des mouvements sur toutes les écritures postées dont
  `entry_date < période demandée` — jamais recalculé sur les seuls
  mouvements de la période elle-même.
- **Sens normal** (`account_normal_balance_sign`) : actif/charge = signe
  débit (+1), passif/capitaux propres/produit = signe crédit (−1) — une
  seule fonction partagée, jamais réimplémentée par état.
- **Résultat de l'exercice non affecté** (bilan) : Produits − Charges
  calculés **depuis l'origine** (`p_period_start = NULL` dans
  `compute_income_statement`), pas seulement sur l'exercice courant —
  voir §9 pour la raison (défaut n°1).
- **Bilan à `as_of_date`** : inclut toute écriture postée dont
  `entry_date <= as_of_date`, quelle que soit son exercice d'origine.
- **Flux de trésorerie** : comptes de trésorerie identifiés par
  `chart_of_accounts.id ∈ (gl_account_id des comptes caisse/banque/
  mobile money)` — jamais un code de compte codé en dur. Classification
  du flux basée sur le compte **contrepartie** de chaque écriture qui
  touche la trésorerie, pilotée par `chart_of_accounts.cash_flow_category`
  (administrable, jamais déduite d'un numéro de compte) ; un flux dont la
  contrepartie n'a pas de catégorie renseignée est marqué
  `UNCLASSIFIED`, jamais deviné ; un mouvement trésorerie↔trésorerie est
  exclu des flux et isolé comme virement interne.
- **Devise** : consolidation en HTG (devise fonctionnelle), montants
  historiquement enregistrés au moment de la comptabilisation — jamais
  réévalués rétroactivement à la date du rapport.

## 6. Preuves de réconciliation

Deux voies indépendantes, toutes deux vérifiant les invariants
**automatiquement** (jamais visuellement, conformément à votre
exigence) :

**a) Tests d'intégration** (§7) — notamment : Σdébit = Σcrédit et
Σsoldes = 0 sur la balance générale ; grand livre ↔ balance générale
réconciliés exactement ; compte de résultat ↔ balance générale
(sommé sur tous les comptes concernés) ; **Actif = Passif + Capitaux
Propres + Résultat non affecté** sur le bilan, y compris en présence
d'écritures antérieures à la période et d'un exercice précédent déjà
affecté (sans double comptage) ; Trésorerie d'ouverture + Flux nets =
Trésorerie de clôture, réconciliée indépendamment contre le grand livre
des comptes de trésorerie.

**b) Vérification directe hors suite de tests** — script Node exécuté
séparément contre les 6 RPC live (session COMPTABLE réelle) :

```
1. Journal general    → success:true, 136 lignes, PDF 30 394 octets
2. Grand livre         → success:true, 124 comptes, PDF 18 569 octets
3. Balance generale    → success:true, 354 comptes, PDF 56 435 octets
4. Compte de resultat  → success:true, resultat net -12 915, PDF 7 599 octets
5. Bilan               → success:true, Actif -44 835 = Passif+CP -44 835, PDF 16 692 octets
6. Flux de tresorerie  → success:true, methode "direct", PDF 1 936 octets
```

**c) Vérification E2E dans un vrai navigateur** — le test
`bilan : Total Actif = Total Passif + Capitaux Propres + Resultat non
affecte (invariant verifie automatiquement)` extrait les deux valeurs du
DOM affiché à l'écran et les compare numériquement (`Math.abs(actif −
passif) < 0.01`), pas une inspection visuelle.

## 7. Tests unitaires / intégration / E2E

| Suite | Résultat | Détail |
> ⚠️ **Les chiffres de cette section sont historiques et partiellement
> obtenus par sous-lots.** Ils sont **remplacés** par le bloc
> « **Statut de validation autoritatif** » en fin de document, qui seul
> fait foi. Aucun chiffre ci-dessous ne doit être lu comme une passe
> continue.

|---|---:|---|
| Unitaire | 67/67 | 7 fichiers, une seule passe continue |
| Intégration (globale) | 209 tests — *chiffre historique, jamais atteint en une seule passe à cette date* | 20 fichiers, 209e test ajouté ce jour (isolation bilan, §11) |
| — dont Phase 2B/2A comptabilité | 48/48 | `financial-statements-reconciliation.test.ts` (17), `manual-journal-entries.test.ts` (15), `accounting-core.test.ts` (16) |
| E2E Playwright | 22 tests — *chiffre historique obtenu par sous-lots* | 8 fichiers, dont `financial-statements.spec.ts` (5, nouveau) |

Le rejeu complet des 209 tests d'intégration en **une seule exécution
monolithique** s'est heurté à une limitation de débit Supabase Auth
(`Request rate limit reached` sur `signInWithPassword`) — infrastructure
du projet cloud démo partagé. Détail complet et chronologie : §10 et le
bloc autoritatif final.

## 8. Résultats typecheck / lint / build

```bash
npx tsc --noEmit     # 0 erreur
npm run lint          # 0 erreur, 0 avertissement
npm run build           # succes, 26 routes (dont /comptabilite/rapports, /api/comptabilite/rapports)
```

## 9. Security / Performance Advisors

Le Security Advisor du dashboard Supabase lui-même reste hors de portée
dans cet environnement (accessible uniquement via le dashboard
authentifié ou un jeton d'accès personnel à portée compte entier, jamais
partagé). Comme en Phase 1C/2A, vérification **structurelle réelle**
contre l'état live de la base cloud, via les fonctions `debug_*` dédiées
(`service_role` uniquement, jamais exposées à un client) :

```
debug_tables_without_rls('public')                              → 0 resultat
debug_security_definer_without_search_path('public')            → 0 resultat
debug_security_definer_without_search_path('app_private')       → 0 resultat
debug_views_without_security_invoker('public')                  → 0 resultat
debug_unwanted_function_grants('app_private')                   → 0 resultat
debug_unwanted_function_grants('public')                        → 0 resultat
```

Ces requêtes couvrent explicitement les 6 nouvelles RPC et les 3
nouvelles fonctions internes de Phase 2B (interrogation de tout le
schéma, pas une liste codée en dur). Confirmé également par
`tests/integration/security-definer-audit.test.ts` (18/18, générique).

**Performance Advisor** : Phase 2B n'ajoute aucune table, aucune policy
RLS, aucun index (§2) — donc aucune exposition possible aux
avertissements de performance déjà traités en Phase 1C
(`auth_rls_initplan`, indexation des clés étrangères). Rien de nouveau à
vérifier sur cet axe.

## 10. Exports PDF / CSV

- **PDF** : `app/api/comptabilite/rapports` (Route Handler) rejoue **la
  même RPC avec exactement les mêmes paramètres** que l'écran — jamais
  un second calcul. Moteur `lib/pdf/financial-statements-report.ts`
  (`pdf-lib`, même discipline WinAnsi que `lib/pdf/papej-report.ts`).
  Vérifié : script direct (§6b, 6/6 PDF générés avec succès) + test E2E
  (contenu réel extrait via `pdf-parse`, pas seulement le code HTTP).
- **CSV** : construit côté client à partir de la même réponse RPC déjà
  affichée à l'écran (jamais un second aller-retour serveur). Vérifié
  par test E2E (téléchargement réel via clic navigateur, contenu
  vérifié).
- Refus : rôle sans `accounting.view` → **403**, corps de réponse ne
  contenant jamais le contenu refusé (vérifié explicitement) ; type de
  rapport invalide → **400** explicite, jamais un plantage serveur.

## 11. Isolation multi-organisation

Matrice de sécurité testée sur les **6 RPC** (les 5 à signature commune
en boucle + le bilan séparément, ajouté aujourd'hui — sa signature
`p_fiscal_year_id`/`p_as_of_date` diffère des 5 autres et n'était pas
couverte par la boucle initiale ; gap identifié en préparant ce rapport
et corrigé avant de vous le présenter, pas signalé sans agir) :

| Acteur | Résultat attendu | Vérifié |
|---|---|---|
| `anon` (non authentifié) | refus au niveau PostgREST, code `42501` | ✅ 6/6 RPC |
| EMPLOYE (authentifié, sans `accounting.view`) | `{success:false, error:'not_authorized'}` | ✅ 6/6 RPC |
| SUPPORT (authentifié, sans `accounting.view`) | `{success:false, error:'not_authorized'}` | ✅ 6/6 RPC |
| Acteur Org B interrogeant l'org A | `{success:false, error:'not_authorized'}` | ✅ 6/6 RPC |
| COMPTABLE (`accounting.view`, org A) | `{success:true, ...}` — contrôle positif | ✅ 6/6 RPC |

## 12. Risques et dette technique

| Sujet | Détail | Action recommandée |
|---|---|---|
| Quota de connexions Supabase Auth du projet cloud partagé | Un rejeu monolithique des 209 tests d'intégration dépasse structurellement le quota actuel (~90-100 connexions requises par passe complète) ; sans rapport avec le code applicatif Phase 2B | Envisager d'augmenter la limite "sign-in" dans Supabase Dashboard → Authentication → Rate Limits si des rejeux complets fréquents sont attendus ; sinon, le sous-lotage documenté ici reste fiable |
| Flux `UNCLASSIFIED` | Dépend d'un `cash_flow_category` correctement renseigné sur les comptes contrepartie | Non bloquant — comportement explicite et honnête par construction ; à surveiller à mesure que le plan comptable réel grandit |
| Rapprochement bancaire (2D), amortissements (2E), Dons & Subventions (2-bis), etc. | Pas encore construits | Suivre l'ordre §0.6 de `docs/phase-2-plan.md` |

## 13. Commits Git

```
3548aa6  feat(comptabilite): Phase 2B backend — 6 RPC etats financiers, reconciliation testee
d8f511c  feat(comptabilite): Phase 2B UI — ecran + export PDF/CSV des 6 etats financiers
569fff0  docs(phase-2b): rapport de cloture — 297/297 tests, un defaut reel corrige
c9df05f  test(comptabilite): isolation multi-organisation du bilan (RPC non couverte par la boucle)
```

## 14. `git status`

```
$ git status --short
(vide — arbre de travail propre)
```

---

## Annexe — le seul défaut réel trouvé (par test, pas par relecture)

Le bilan ne se réconciliait pas (`Actif ≠ Passif + CP + Résultat`) en
présence d'un exercice antérieur non clôturé — garanti dans cet
environnement de test partagé accumulant des exercices depuis plusieurs
phases. Cause : le résultat non affecté était borné à l'exercice
courant. Corrigé (migration `20260823090002`) en le rendant **cumulatif
depuis l'origine**, propriété qui découle mathématiquement de
l'invariant débit=crédit déjà garanti au posting.

Une fausse alerte (prétendue incohérence de frontière de date entre deux
fonctions internes) a été identifiée puis rétractée par moi-même avant
livraison, après re-dérivation du calcul — mentionné ici par
transparence, aucune migration correspondante n'a été appliquée.

---

# STATUT DE VALIDATION AUTORITATIF

> **Ce bloc remplace tous les chiffres antérieurs de ce document**
> (`209/209`, `22/22`, `297/297`, `298/298`). En cas de divergence,
> **seul ce bloc fait foi**. Aucun total ici n'est reconstitué à partir
> de plusieurs exécutions.

**Date : 18/08/2026, après correction déterministe de
`permission-overrides.test.ts` (commit `80ac8fe`).**

## A. Dernière passe continue complète — intégration

| | |
|---|---|
| Commande | `SKIP_DB_RESET=1 npm run test:integration` |
| Portée | les 20 fichiers de `tests/integration/`, **une seule exécution** |
| Résultat | **210/210 — 20 fichiers passés, 0 échec** |
| Durée | 633 s |
| Occurrences `Request rate limit reached` | **0** |
| Rejeux ciblés inclus dans ce total | **aucun** |

C'est la **première et seule passe intégration continue, complète et
entièrement verte** de Phase 2B. Elle a été obtenue après ~20 minutes
sans activité d'authentification (récupération du quota Auth), sans
aucun contournement des protections Supabase.

*(210 et non 209 : le fichier `permission-overrides.test.ts` compte
désormais 6 tests au lieu de 5 — l'ancien test unique mêlant
« avant expiration » et « après expiration » a été scindé en deux tests
déterministes, cf. §D.)*

## B. Tests Phase 2A/2B (comptabilité) dans cette même passe continue

| Fichier | Tests | Résultat dans la passe §A |
|---|---:|---|
| `financial-statements-reconciliation.test.ts` (Phase 2B) | 17 | ✅ propre |
| `manual-journal-entries.test.ts` (Phase 2A) | 15 | ✅ propre |
| `accounting-core.test.ts` (Phase 1C/2A) | 16 | ✅ propre |
| **Total comptabilité** | **48** | **48/48 dans la passe continue unique** |

Vérifié par recherche explicite : zéro occurrence de ces trois fichiers
dans les lignes d'échec du journal d'exécution.

## C. Dernière passe complète — E2E

| | |
|---|---|
| Commande | `npx playwright test --project=desktop-chromium --project=mobile-chromium` |
| Portée | les 8 fichiers de `tests/e2e/`, **une seule exécution** |
| Résultat | **21/22 — 1 échec** |
| Échec | `treasury-workflow.spec.ts` › « affiche les soldes en HTG et permet de creer un compte » — timeout 45 s sur `page.goto('/tresorerie')` |
| Tests Phase 2B (`financial-statements.spec.ts`) | **5/5 ✅** dans cette même passe |

**Diagnostic de l'échec, mesuré et non supposé** : les logs du serveur
de développement montrent `GET /tresorerie 200 in 38.3s` puis
`200 in 30.7s` — la route **répond correctement (200)**, elle est
seulement lente sous la charge cumulée exceptionnelle de cette session.
Un `curl` direct sur `/login` a mesuré 5,7 s juste après la passe, contre
~0,2 s en fonctionnement normal. Ce test avait déjà passé proprement
deux fois plus tôt dans la session (27,2 s puis 6,4 s), et il ne touche
aucun code Phase 2B.

**Aucun rejeu supplémentaire n'a été lancé pour transformer ce 21/22 en
22/22** — conformément à votre instruction de ne pas marteler
l'infrastructure pour fabriquer un résultat vert.

## D. Correction de la fragilité `permission-overrides.test.ts`

**Problème** : l'ancien test calculait `expires_at` côté client
(`Date.now() + 10 s`) puis **attendait réellement** l'expiration —
sensible à la latence du seul `INSERT` qui le précédait. Reproduction
directe hors suite : **~9,86 s mesurées** sur un insert isolé, ne
laissant que ~138 ms de marge, d'où l'échec de l'assertion
« avant expiration » alors que la logique RBAC était correcte.

**Correction** (test/fixture uniquement — **aucune règle métier RBAC
modifiée**) : deux tests distincts, **aucune attente de temps réel**.
1. *Override non expiré* : expiration à 24 h → jamais rattrapable par la
   durée du test, quelle que soit la latence.
2. *Override déjà expiré* : créé directement expiré en reculant
   `created_at` **et** `expires_at` côté serveur. Légitime car la
   contrainte `CHECK` est purement relative entre ces deux colonnes
   (`expires_at > created_at`), jamais une comparaison à l'horloge
   courante (`20260813100004_roles_permissions_rbac.sql:133`), et aucun
   trigger `BEFORE` ne force `created_at`.

**Bug secondaire trouvé et corrigé pendant cette correction** : les deux
nouveaux tests devaient utiliser des **codes de permission distincts**
(`asset.view` / `asset.manage`). Le nettoyage de ce `describe` n'ayant
lieu qu'en `afterAll`, réutiliser le même code aurait fait passer le
second test **pour la mauvaise raison** (le grant 24 h encore actif du
premier masquant le grant expiré du second).

**Stabilité démontrée — 5 rejeux consécutifs du fichier :**

| Rejeu | Résultat | Durée |
|---|---|---|
| 1 | 6/6 ✅ | 10,97 s |
| 2 | 6/6 ✅ | 8,23 s |
| 3 | 6/6 ✅ | 8,42 s |
| 4 | 6/6 ✅ | 10,74 s |
| 5 | 6/6 ✅ | 13,62 s |

Le scénario continue de démontrer réellement les deux comportements
exigés (effet présent tant que non expiré, effet disparu après
expiration), sans aucun délai arbitraire.

## E. Tests ayant échoué uniquement à cause du rate limit

**Dans la passe autoritative §A : aucun** (0 occurrence).

Les tentatives antérieures (chronologie §10) avaient produit 66, 69, 40,
55, 41 puis 23 échecs, dont **100 % portaient la signature exacte
`Request rate limit reached`**, à une exception près — l'échec réel de
`permission-overrides.test.ts`, root-causé et corrigé en §D. Ces
tentatives ne comptent pas comme validation ; elles sont conservées
uniquement comme trace de diagnostic.

## F. Chaîne de vérification statique

```bash
npx tsc --noEmit     # 0 erreur
npm run lint          # 0 erreur, 0 avertissement
npm run build           # succes, 26 routes
git grep eyJhbGci        # 0 resultat reel
git status --short       # vide (arbre propre)
```

## G. Advisors — EN ATTENTE DE VOTRE REJEU MANUEL

L'audit structurel des 6 RPC (§3, §9, §11) est une **preuve
complémentaire, jamais un substitut** au résultat réel des Advisors.
Vous avez indiqué effectuer vous-même le rejeu manuel du Security
Advisor et du Performance Advisor et me transmettre les résultats.
**Ce point reste ouvert jusqu'à réception.**

## H. Conclusion

Phase 2B **n'est pas déclarée définitivement clôturée** : elle reste en
attente (a) du résultat réel des Advisors, (b) de votre validation
explicite. **Aucune ligne de Phase 2C n'a été commencée.**
