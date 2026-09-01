# Phase 2D — Rapprochement bancaire et de trésorerie — Rapport de clôture

**Verdict : PHASE 2D CLOSED.**

Date de clôture : 2026-09-01.
Projet Supabase cible : `qwydgqheceglulfxwtgo` (cloud).

---

## 1. Périmètre livré

| Élément | Détail |
|---|---|
| Migrations | `20260830090001_bank_reconciliation.sql`, `20260830090002_bank_reconciliation_fix_uuid_aggregate.sql` |
| Tables | `bank_statement_imports`, `bank_statement_lines`, `bank_reconciliation_matches` |
| RPC publiques | 7 — `import_bank_statement`, `propose_bank_reconciliation`, `create_manual_bank_match`, `validate_bank_match`, `reject_bank_match`, `cancel_bank_statement_import`, `generate_bank_reconciliation_report` |
| Fonctions `app_private` | 6 — 5 triggers de cohérence/immutabilité + le helper confiné `treasury_account_exists` |
| Écrans | `/tresorerie/rapprochement`, `/tresorerie/rapprochement/importer`, `/tresorerie/rapprochement/[id]`, lien depuis `/tresorerie` |
| Server Actions | `app/actions/reconciliation.ts` (6) |
| Composants | `statement-import-form.tsx`, `manual-match-form.tsx` |
| Tests d'intégration | `tests/integration/bank-reconciliation.test.ts` — 43 tests |
| Tests E2E | `tests/e2e/reconciliation-ui.spec.ts` — 2 tests |

Les 13 fonctions Phase 2D sont en `set search_path = ''`. Aucune permission nouvelle n'a été créée :
`treasury.manage`, `treasury.reconcile` et `accounting.view` existaient depuis la Phase 1A.

---

## 2. Principe directeur — aucune seconde source comptable

Le rapprochement **compare** des données externes (relevés) aux mouvements de trésorerie et écritures
déjà existants. Aucune RPC de la Phase 2D ne crée de `journal_entries`, ne modifie un montant ni une
imputation. Un seul champ est écrit hors des trois tables de rapprochement :
`public.cash_movements.reconciled` — un drapeau **opérationnel**.

Si un écart réel exige un ajustement comptable, il passe par le moteur existant (écriture manuelle
Phase 2A, avec sa séparation saisie/validation). L'écran de rapprochement l'indique explicitement
lorsqu'un écart subsiste.

Preuve : test 35, comptage de `journal_entries` avant et après le cycle complet de rapprochement.

---

## 3. Preuves d'exécution

Toutes obtenues après application des deux migrations sur le projet cloud.

| Passe | Commande | Résultat |
|---|---|---|
| Suite 2D | `SKIP_DB_RESET=1 npx vitest run tests/integration/bank-reconciliation.test.ts` | **43/43**, 68,30 s, exécution unique et continue |
| Non-régression, 12 fichiers | trésorerie / comptabilité / facturation + 3 suites d'audit sécurité | **239/239** — 122 sur 9 fichiers verts d'emblée, 117 sur les 3 fichiers réparés (§ 6) |
| Typecheck | `npm run typecheck` | 0 erreur |
| Lint | `npm run lint` | 0 erreur |
| Build | `npm run build` | succès, les 4 routes 2D émises |
| E2E ciblé | `npx playwright test tests/e2e/reconciliation-ui.spec.ts` | **2/2** (48,6 s et 19,7 s) |

Les suites d'intégration ont tourné avec `SKIP_DB_RESET=1` : elles ciblent le projet cloud, et le
`supabase db reset` de `tests/global-setup.ts` réinitialise une base **locale** que les tests
n'utilisent pas (voir dette § 8.2). Ce drapeau ne retire aucune garantie de déterminisme, celui-ci
étant porté par le `FixtureRegistry`.

### 3.1 Les 43 tests d'intégration

**Import de relevé (7)** — import valide avec devise déduite du compte ; doublon de contenu refusé
sur le même compte ; même contenu accepté sur un autre compte ; compte inexistant ; relevé vide ;
période invalide ; compte d'Org B refusé sous Org A.

**Rapprochement automatique déterministe (6)** — correspondance exacte ; tolérance de date ±3 j avec
écart enregistré ; ambiguïté (2 candidats) ⇒ aucune proposition ; montant différent ; sens
différent ; mouvement déjà engagé jamais reproposé.

**Rapprochement manuel et écarts (5)** — écart de montant enregistré et jamais absorbé ; écart de
date mesuré et conservé ; devise incompatible ; sens incompatible ; IDOR sur mouvement d'Org B.

**Validation, SoD et double rapprochement (7)** — auto-validation bloquée ; validation par acteur
distinct ; double rapprochement refusé ; garantie **en base** par index unique partiel ; seconde
validation refusée ; rejet motivé libérant la ligne ; rejet sans motif refusé.

**Période comptable clôturée (1)** — validation refusée si le mouvement relève d'une période fermée.

**Immutabilité et non-destruction (6)** — rapprochement validé non supprimable même via
`service_role` ; non modifiable ; données importées immuables ; annulation d'import refusée si un
rapprochement validé en dépend ; annulation possible sinon ; **cycle complet** import → proposition →
annulation → réimport du même contenu → le mouvement redevient rapprochable.

**Intégrité du compte de trésorerie en base (2)** — appartenance organisationnelle et devise
imposées par trigger DB, opposables même via `service_role`.

**Aucune seconde source comptable (1)** — zéro `journal_entry` créé par le cycle complet.

**État de rapprochement (1)** — solde comptable, solde relevé, écart et lignes non rapprochées.

**Sécurité (7)** — `anon` sur toutes les RPC ; `EMPLOYE` refusé à l'import ; `EMPLOYE` ne voit aucun
relevé ; IDOR en lecture Org A/Org B ; aucune écriture directe dans les trois tables ; helper
`app_private` non exposé via PostgREST ; aucune fonction à `search_path` mutable.

### 3.2 Les 2 tests E2E

Parcours navigateur réel, connexion par le formulaire.

1. **Cycle complet** — import CSV normalisé côté navigateur, prévisualisation, import ; page de
   rapprochement affichant solde comptable et solde relevé côte à côte ; proposition automatique
   (ligne `Non rapproche` → `Propose`) ; annulation motivée (import `Annule`, ligne revenue à
   `Non rapproche`, donc proposition neutralisée sans statut intermédiaire résiduel).
2. **Liste et filtre** — l'import apparaît dans la liste des relevés et le filtre par référence le
   retrouve.

---

## 4. Les 13 points de vérification exigés

| # | Point | Preuve |
|---|---|---|
| 1 | Zéro `journal_entry` créé par le rapprochement | Test 35 (comptage avant/après) |
| 2 | Import dupliqué refusé | Tests 2 et 3 |
| 3 | Réimport après annulation accepté | Test 32 (cycle complet) |
| 4 | Proposition ambiguë ⇒ aucune proposition | Test 10 |
| 5 | Double rapprochement impossible | Tests 21, 22 (index unique partiel en base), 23 |
| 6 | SoD proposant / validateur | Tests 19 et 20 |
| 7 | Période clôturée | Test 26 |
| 8 | Isolation Org A / Org B | Tests 7, 18, 40 |
| 9 | Garde `service_role` compte / devise | Tests 33 et 34 |
| 10 | Rapprochement validé immuable | Tests 27, 28, 30 |
| 11 | `cash_movements.reconciled` correctement positionné | Test 20 (`true` à la validation), test 32 (`false` après annulation d'une proposition) |
| 12 | `search_path` exact | Test 43, `debug_functions_with_mutable_search_path('public') = []` vérifié en direct, et blocs `DO $verify$` exigeant `search_path=""` |
| 13 | Helper `app_private` non exposé | Test 42 + assertion `has_function_privilege` dans le `DO $verify$` |

---

## 5. Défauts introduits puis corrigés

Aucun de ces trois défauts n'est arrivé en production : tous ont été détectés et corrigés avant
clôture. Ils sont consignés ici parce qu'ils sont de ma responsabilité.

### 5.1 `42804` — `RETURN <valeur>` avec un paramètre `OUT`

`app_private.treasury_account_exists` déclarait `p_currency out char(3)` **et** retournait une
expression, ce que PL/pgSQL interdit. La première tentative d'application de `090001` a échoué
transactionnellement — rien n'a été créé.

Corrigé **dans `090001`, avant tout déploiement** (aucun fichier `090002` créé à ce stade) : fonction
scalaire stricte à 3 paramètres d'entrée, sans aucun `OUT`. Le type de compte inconnu retourne `null`
explicitement au lieu de retomber sur `mobile_money_accounts`, ce qui rend le helper correct par
lui-même, indépendamment de la validation faite en amont par la RPC.

Vérifié après correction : aucune déclaration `OUT`/`INOUT` dans le fichier, et aucune autre fonction
Phase 2D combinant paramètre `OUT` et `RETURN <valeur>`.

### 5.2 `42883` — `min(uuid)` n'existe pas

`propose_bank_reconciliation` sélectionnait le candidat via `min(m.id)` sur un `uuid`. Défaut
**latent** : PL/pgSQL ne résout les identifiants de fonction qu'à l'exécution du corps, donc ni le
typecheck, ni le lint, ni l'auto-vérification de la migration ne pouvaient le détecter avant la
première exécution réelle. Il s'est manifesté sur 8 des 43 tests, dont 7 masquaient l'erreur
PostgreSQL en ne déstructurant que `data` sans lire `error`.

Corrigé par `20260830090002` : `(array_agg(m.id))[1]`. `array_agg` accepte les `uuid` ; la valeur
n'est lue que dans la branche `v_candidate_count = 1`, où l'agrégat ne contient qu'un élément — le
déterminisme « exactement un candidat, sinon aucune proposition » est strictement inchangé. Un diff
du corps contre `090001` a confirmé que cette ligne et son commentaire sont la seule différence.

### 5.3 Une auto-vérification qui se serait auto-refusée

Le commentaire explicatif rédigé dans `090002` contenait littéralement la chaîne `min(m.id)`. Comme
un commentaire fait partie de `prosrc`, l'assertion `prosrc not like '%min(m.id)%'` aurait fait
échouer la migration **correcte**. Commentaire reformulé, puis les deux prédicats vérifiés
mécaniquement sur le fichier avant envoi.

### 5.4 Erreur de comptage

J'ai annoncé « 42 tests attendus » ; le total réel est **43**. Mon addition (39 + 3) était fausse
d'une unité. Aucun test surnuméraire — une erreur de comptage de ma part.

---

## 6. Échec externe rencontré et traité — bascule de calendrier

Le 2026-09-01, 59 tests répartis sur `invoicing-documents`, `invoice-accounting` et
`customer-payments` ont échoué sur `{"error":"no_accounting_period","success":false}` à l'émission de
facture.

**Sans lien avec la Phase 2D.** Aucune ligne de `090001` ni de `090002` ne touche
`accounting_periods`, `fiscal_years`, `app_private.find_period_for_date` ou
`issue_invoice_document`. La preuve la plus nette est ce couple d'assertions :
`expected 'no_accounting_period' to be 'tax_account_not_configured'` — le test attendait un refus
métier précis, mais la garde de période court-circuite désormais tout le reste.

**Cause racine.** `find_period_for_date` exige une ligne `accounting_periods` dont `month` vaut le
mois de la date, dans un exercice couvrant cette date. Aucune période de mois 9 n'existait pour les
organisations de démo. La date a basculé au 1er septembre pendant les travaux ; la veille, l'émission
trouvait sa période. Les trois suites ne provisionnaient jamais de période ouverte pour le mois
courant : elles n'en créaient que pour leurs tests **négatifs** (mois 5 et 6, statut `closed`, sur
des exercices lointains 2035/2036).

**Correctif retenu — durable, décidé par Jean Alix Pierre.** Aucune période de septembre 2026 créée
manuellement. Les trois suites provisionnent elles-mêmes, dans leur `beforeAll`, une période ouverte
couvrant la date de leurs scénarios, quel que soit le mois d'exécution. 241 insertions, 0 suppression ;
aucune logique de test existante modifiée ; aucun code applicatif, aucune RPC, aucune migration,
aucune règle comptable Phase 2C touchés.

Le helper échoue **bruyamment** si une période `closed` concurrente existe pour la même date :
`find_period_for_date` ne filtre pas sur le statut et fait `limit 1` sans `ORDER BY`, donc une
période fermée concurrente rendrait la résolution non déterministe. Un échec explicite vaut mieux
qu'un résultat aléatoire.

Résultat après correctif : **117/117** sur les trois suites, soit **239/239** pour la campagne
complète en combinant avec les 9 fichiers déjà verts.

---

## 7. Garde-fou d'auto-vérification

Les deux migrations se terminent par un bloc `DO $verify$` qui lève une exception — annulant donc la
transaction entière — si le résultat attendu n'est pas réellement en place. Ce mécanisme vient de la
Phase 2C, où deux migrations correctives sont restées silencieusement sans effet.

`090001` contrôle : les 3 tables créées ; les 7 RPC créées ; le `search_path` **exactement vide**
(`search_path=""` ou `search_path=`) et non la simple présence d'une configuration ; l'existence des
**13** fonctions attendues — sans quoi le contrôle précédent passerait à vide sur une fonction
manquante ; l'armement du trigger d'appartenance du compte ; la non-exposition des deux helpers
`app_private` à `anon` et `authenticated`.

`090002` contrôle : l'existence de la fonction ; son `search_path` exactement vide ; la présence de
`(array_agg(m.id))[1]` dans `prosrc` ; l'absence de `min(m.id)`.

---

## 8. Dettes résiduelles — non traitées, sur décision explicite

### 8.1 Messages UI manquants pour deux codes de refus

`duplicate_import` et `has_validated_matches` ne figurent pas dans `ERROR_MESSAGES` de
`lib/actions/rpc-result.ts`. L'interface affiche donc le repli générique
`Action refusee (duplicate_import).` au lieu d'un message métier en français.

Impact : **cosmétique uniquement**. Le refus est correct, tracé en audit et fidèlement restitué ;
seul son libellé est pauvre. Aucune règle de sécurité ni de comptabilité n'est concernée.

Correction future : ajouter les deux entrées dans `ERROR_MESSAGES`. Décision de ne pas traiter
maintenant.

### 8.2 Stack Docker Supabase local dégradé

État constaté le 2026-09-01 :

```
supabase_db_medfinder-gestion       Up (unhealthy)
supabase_kong_medfinder-gestion     Exited (255) il y a 13 jours
supabase_rest_medfinder-gestion     Exited (255) il y a 13 jours
supabase_studio / pg_meta / edge_runtime / inbucket   Exited (255) il y a 13 jours
```

`tests/global-setup.ts` lance `npx supabase db reset` **inconditionnellement**, alors que
`vitest.config.ts` charge `.env.local`, dont `NEXT_PUBLIC_SUPABASE_URL` pointe sur le projet cloud.
Le reset réinitialise donc une base locale que les tests n'utilisent pas : il ne conditionne pas leur
déterminisme, mais il bloque le démarrage de la suite lorsque les conteneurs sont malades
(`LegacyHealthCheckTimeoutError` sur le conteneur storage, vitest s'arrêtant avant de charger le
moindre fichier de test).

Contournement en vigueur : `SKIP_DB_RESET=1`, drapeau déjà prévu par le projet et utilisé par le
script `test:unit`.

Élément utile relevé au passage : avant d'échouer sur le health check, le reset local a exécuté avec
succès `Applying migration 20260830090001_bank_reconciliation.sql` — la migration s'applique donc
proprement aussi sur une base vierge reconstruite depuis zéro.

Correction future : réparer le stack Docker, ou rendre le reset conditionnel à une cible locale.
Décision de ne pas traiter maintenant.

---

## 9. Modifications hors périmètre strict, conservées sur décision

**`.claude/launch.json` — `"autoPort": true`.** Le port 3000 est occupé par une autre application
(« Mission Église Évangélique Sel et Lumière »). Le premier E2E a tourné contre elle avant détection ;
le serveur MedFinder démarre désormais sur un port libre et l'E2E vise `E2E_BASE_URL`.

**`tests/e2e/fixtures.ts`.** Deux fonctions Phase 2D ajoutées — `createTreasuryAccountWithMovement`
(compte de trésorerie dédié portant un mouvement, condition du déterminisme du rapprochement
automatique) et `cleanupBankStatementImport` (nettoyage d'un import créé par l'UI, donc non suivi par
un `FixtureRegistry`). Purement additif ; les fixtures Phase 2C existantes sont inchangées.

---

## 10. Limites du périmètre

Phase 2E non commencée. Phases 2B et 2C non rouvertes — aucune régression directement causée par la
Phase 2D n'a été constatée ; les modifications des trois suites de facturation relèvent de la bascule
de calendrier documentée au § 6, sur arbitrage explicite.
