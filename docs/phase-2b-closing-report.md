# Phase 2B — États financiers — Rapport de clôture

Statut : **VALIDÉE FONCTIONNELLEMENT, EN ATTENTE DE VOTRE VALIDATION**
avant tout début de Phase 2C — conformément à votre instruction explicite
("commence Phase 2B uniquement. Ne commence pas 2C... Arrête-toi ensuite
pour validation"). Aucune ligne de Phase 2C n'a été commencée.

## 1. Périmètre livré (conforme à `docs/phase-2b-plan.md`, incluant les 13 ajustements)

Six états financiers, tous dérivés **exclusivement** de
`journal_entries`/`journal_entry_lines` **comptabilisées** — jamais des
modules métier (Dépenses/PAPEJ/facturation/`cash_movements`) directement :

- **Journal général** (`generate_general_journal_report`) — filtrable par
  période et journal, colonnes complètes (période, journal, numéro, date,
  référence, libellé, compte, débit, crédit, source métier, centre de
  coût).
- **Grand livre** (`generate_general_ledger_report`) — solde d'ouverture
  calculé sur les écritures **antérieures** à la période (jamais
  recalculé sur les seuls mouvements de la période), mouvements, solde
  progressif, solde de clôture.
- **Balance générale** (`generate_trial_balance_report`) — solde
  ouverture/débit/crédit période/solde clôture par compte ; invariants
  Σdébit=Σcrédit et Σsoldes=0 vérifiés automatiquement (pas visuellement).
- **Compte de résultat** (`generate_income_statement_report`) — Résultat =
  Produits − Charges sur la période, réconcilié exactement avec les mêmes
  comptes en balance générale.
- **Bilan** (`generate_balance_sheet_report`) — calculé à `as_of_date`,
  inclut une ligne « Résultat de l'exercice non affecté » pour satisfaire
  Actif = Passif + Capitaux Propres + Résultat, cumulatif depuis
  l'origine (voir §3, défaut n°1 — c'est la correction qui garantit cette
  propriété).
- **Flux de trésorerie** (`generate_cash_flow_report`, méthode directe
  explicitement indiquée) — comptes de trésorerie identifiés via
  `chart_of_accounts.id ∈ (gl_account_id des comptes caisse/banque/mobile
  money)`, jamais un code de compte codé en dur ; classification
  Exploitation/Investissement/Financement pilotée par le nouveau champ
  administrable `chart_of_accounts.cash_flow_category` (jamais déduite
  d'un numéro de compte) ; flux non classifiables marqués `UNCLASSIFIED`
  explicitement, jamais inventés ; virements internes (mouvements
  trésorerie↔trésorerie) exclus des flux et isolés à part ; Trésorerie
  d'ouverture + Flux nets = Trésorerie de clôture réconciliée exactement
  avec le grand livre des comptes de trésorerie.

**Devises** : états consolidés en HTG (devise fonctionnelle), montants
historiquement enregistrés, jamais réévalués rétroactivement.

**Sécurité RPC** (les 6) : `security definer`, `search_path` fixe,
`accounting.view` vérifié via `has_permission`, org dérivée du contexte
authentifié (jamais un paramètre client de confiance), refus explicite
`{success:false, error:'not_authorized'}` (jamais d'exception qui casse
l'audit), `service_role` jamais exposé côté client.

**Exports** : CSV (client, construit depuis la même réponse RPC déjà
affichée à l'écran) et PDF (`app/api/comptabilite/rapports`, Route
Handler qui rejoue **la même RPC avec les mêmes paramètres** que l'écran
— jamais un second calcul) pour les 6 états.

## 2. Ce qui n'a pas été recréé

`journal_entries`/`journal_entry_lines`, `post_journal_entry`,
`chart_of_accounts`, le moteur de périodes/exercices, le patron RPC
`security definer` établi en 1C/2A — tous réutilisés sans modification.
Seuls ajouts structurels : `chart_of_accounts.cash_flow_category`
(colonne nullable, jamais retirée d'un compte utilisé),
`app_private.account_normal_balance_sign`,
`app_private.compute_income_statement`,
`app_private.compute_accounts_balance_as_of` — trois fonctions internes
partagées, chacune appelée par plusieurs des 6 RPC publiques plutôt que
dupliquée.

## 3. Deux défauts réels trouvés — par test, pas par relecture de code

**Défaut n°1 — bilan non réconciliable en présence d'un exercice
antérieur non clôturé** (trouvé par le test de réconciliation, pas par
relecture) : la première version de « Résultat de l'exercice non
affecté » était bornée à `[début de l'exercice courant, as_of_date]`.
Dans cet environnement partagé (organisations de test accumulant des
exercices depuis plusieurs phases), au moins un exercice antérieur
existe toujours sans affectation formelle — cassant systématiquement
Actif = Passif + CP + Résultat. Corrigé par la migration
`20260823090002` : le résultat non affecté est désormais **cumulatif
depuis l'origine** (`p_period_start = NULL`), propriété qui découle
mathématiquement de l'invariant débit=crédit déjà garanti au posting, et
qui évite tout double comptage puisqu'une écriture réelle d'affectation
réduit directement le solde cumulatif du compte qu'elle touche.

**Fausse alerte auto-corrigée avant livraison** : j'avais initialement
identifié — et rédigé une migration pour — une prétendue incohérence de
frontière de date entre `compute_accounts_balance_as_of` (borne stricte
`<`) et `compute_income_statement` (borne `<=`). En re-dérivant le calcul
avant d'appliquer quoi que ce soit, j'ai constaté que le code original
était déjà correct ; je vous l'ai signalé explicitement et j'ai supprimé
la migration sans effet plutôt que de la livrer. Mentionné ici par souci
de transparence, conformément à la discipline déjà appliquée dans ce
projet.

## 4. Migrations appliquées (2, par vous, confirmées)

```
20260823090001_financial_statement_reports.sql              (colonne cash_flow_category, 3 fonctions internes, 6 RPC publiques)
20260823090002_fix_balance_sheet_unaffected_result_scope.sql (correctif défaut n°1)
```

## 5. Vérification directe de la génération PDF (hors suite de tests)

En complément des tests automatisés, un script Node exécuté directement
(`tsx`, session authentifiée réelle en COMPTABLE) a appelé les 6 RPC
live puis généré un PDF pour chacune avec `buildTabularReportPdf` — sans
passer par le serveur Next.js ni par un test. Résultat : succès pour les
6 (tailles de PDF non triviales, 1,9 à 56 Ko selon le volume de données),
et le bilan a confirmé numériquement Actif = Passif + CP + Résultat
(−44 835 = −44 835 sur les données cumulées de l'organisation de test)
avant même l'exécution de la suite de tests formelle.

## 6. Tests — couverture réelle

**16 tests de réconciliation** (`tests/integration/financial-statements-reconciliation.test.ts`) :
journal général équilibré, grand livre — solde d'ouverture correct,
grand livre ↔ balance générale réconciliés, balance générale Σ=0, compte
de résultat ↔ balance générale (sommé sur tous les comptes concernés),
bilan Actif=Passif+CP+Résultat (y compris avec des écritures antérieures
à la période), flux de trésorerie — classification
exploitation/investissement/financement/`UNCLASSIFIED`/virement interne,
trésorerie d'ouverture+flux=clôture réconciliée indépendamment du grand
livre, contre-passation, exercice antérieur déjà affecté sans double
comptage, RLS/sécurité (anon/EMPLOYE/SUPPORT/autre organisation refusés,
COMPTABLE positif) sur les 5 RPC hors flux de trésorerie.

**5 tests E2E** (`tests/e2e/financial-statements.spec.ts`, nouveaux
cette session) : journal général — écran et export PDF affichent
exactement la même écriture comptabilisée (contenu réel extrait du PDF
via `pdf-parse`, pas seulement le code HTTP) ; export CSV téléchargé
via un vrai clic navigateur et contenu vérifié ; **invariant du bilan
vérifié automatiquement à l'écran** (Total Actif = Total Passif + CP +
Résultat non affecté, extrait du DOM puis comparé numériquement — jamais
vérifié visuellement, conformément à votre exigence explicite) ; refus
403 + aucune fuite de contenu pour un rôle sans `accounting.view`
(RH, écran et export PDF) ; refus 400 explicite sur un type de rapport
invalide.

**Rejeu complet — reconcilié par sous-lots suite à une limitation de
débit Supabase Auth** (voir §7 pour le diagnostic complet) :

| Suite | Résultat | Détail |
|---|---:|---|
| Unitaire | **67/67** | 7 fichiers, une seule passe continue |
| Intégration | **208/208** | 20 fichiers — reconcilié par 3 passes successives (voir §7), zéro échec non attribuable à la limitation de débit |
| E2E Playwright | **22/22** | 8 fichiers — 21/22 en une passe continue + 1 test reconfirmé isolément après diagnostic (voir §7) |
| **Total** | **297/297** | Aucun échec métier réel constaté nulle part |

## 7. Incidents rencontrés pendant la vérification — diagnostiqués, pas ignorés

**Limitation de débit Supabase Auth (le plus significatif)** : le
premier rejeu complet de la suite d'intégration (208 tests) a échoué à
hauteur de 66 tests, message `Request rate limit reached` sur
`signInWithPassword`. Diagnostic avant toute conclusion : le nombre
d'occurrences de ce message correspondait **exactement** au nombre
d'échecs à chaque tentative (vérifié par `grep -c`), et **zéro** échec,
sur six tentatives consécutives, n'a jamais porté un message différent
(pas une seule assertion métier en échec). Cinq nouvelles tentatives
espacées (5 min, 20 min, 30 min, puis un rejeu complet après 45 min sans
aucune activité de connexion entretemps) ont montré un nombre d'échecs
décroissant mais non nul (66 → 69 → 40 → 55 → 41), cohérent avec un
compte de démonstration partagé dont la demande cumulée de connexions de
la suite complète (~90-100 appels) dépasse structurellement le quota
disponible dans une seule exécution monolithique — indépendamment du
temps d'attente entre exécutions.

Réconciliation retenue : isoler les fichiers encore en échec et les
rejouer en sous-lots plus légers (moins de connexions requises par
exécution) après de courtes pauses. Résultat : les 8 fichiers restants
sont passés à 6/8 propres au premier sous-lot, puis les 2 derniers
(`hr-workflows.test.ts`, `ui-permissions.test.ts` — les plus gros
consommateurs de connexions, rôles multiples + élévation MFA) propres au
second. **Aucun des 20 fichiers, y compris les 3 propres à la Phase 2B,
n'a jamais affiché un échec autre que cette limitation de débit** —
preuve que la Phase 2B elle-même n'introduit aucune régression, la
reconciliation ci-dessus n'ayant servi qu'à prouver chaque fichier
individuellement plutôt qu'à espérer une passe unique chanceuse.

**Serveur de développement arrêté pendant la vérification E2E** : le
premier rejeu E2E complet a échoué à 22/22 (`page.goto` /
`getByLabel('Email')` en timeout dès la première étape de connexion,
sur tous les fichiers y compris `mobile-nav.spec.ts` sans rapport avec
Phase 2B) — diagnostic direct : `preview_list` a montré aucun serveur de
prévisualisation actif, et un `curl` direct vers `localhost:3000` a
confirmé une absence totale de réponse (pas une lenteur). Le port 3000
était occupé par un processus orphelin non suivi (probablement issu de
`npm run build`, qui utilise le même répertoire `.next`) — tué puis
serveur redémarré proprement. Rejeu immédiat : 21/22 propres, un seul
échec restant (`treasury-workflow.spec.ts`, premier test).

**Latence réseau isolée sur `/tresorerie`** : ce dernier échec a été
diagnostiqué avant tout rejeu — les logs du serveur montraient
`GET /tresorerie 200 in 38.3s` puis `200 in 30.7s` (200 réel, juste
lent), pas une erreur applicative, cohérent avec la charge cumulée
exceptionnelle de connexions/requêtes de cette session sur le projet
Supabase partagé. Rejeu isolé : propre deux fois de suite (27,2s puis
dans les tests suivants), confirmant une dégradation réseau transitoire
et non un défaut de code.

## 8. Vérification finale

```bash
npx tsc --noEmit     # 0 erreur
npm run lint          # 0 erreur, 0 avertissement
npm run build           # succes, 26 routes (+ /comptabilite/rapports, /api/comptabilite/rapports)
git grep eyJhbGci        # 0 resultat reel
git status               # propre apres commit (voir §10)
```

**Advisors structurels** : couverts par
`tests/integration/security-definer-audit.test.ts` (18/18, générique —
audite automatiquement toute fonction `SECURITY DEFINER` du schéma,
donc y compris les 6 nouvelles RPC et les 3 fonctions internes de Phase
2B sans liste codée en dur), reconfirmé propre dans cette session.

## 9. Vérification directe des exports (hors navigateur)

Le pane navigateur interactif est resté indisponible pendant une partie
de cette session (« the Browser pane is not displayed, so the page is
not compositing frames » — problème d'outillage, pas de code). Plutôt
que de contourner la vérification, deux voies indépendantes et
équivalentes ont été utilisées à la place : le script Node direct
contre les RPC live (§5) et la suite E2E Playwright réelle (§6), qui
pilote un vrai navigateur Chromium et n'a jamais dépendu du pane
interactif — les deux confirment le même résultat.

## 10. Commits

```
3548aa6  feat(comptabilite): Phase 2B backend — 6 RPC etats financiers, reconciliation testee
d8f511c  feat(comptabilite): Phase 2B UI — ecran + export PDF/CSV des 6 etats financiers
```

## 11. Risques et dette

| Sujet | Détail | Action recommandée |
|---|---|---|
| Quota de connexions Supabase Auth du projet cloud partagé | §7 — un rejeu monolithique des 208 tests d'intégration dépasse structurellement le quota actuel ; sans rapport avec le code applicatif | Envisager d'augmenter la limite de débit "sign-in" dans Supabase Dashboard → Authentication → Rate Limits si des rejeux complets fréquents sont attendus ; sinon, le sous-lotage documenté ici reste une solution de contournement fiable |
| Flux non classifiables (`UNCLASSIFIED`) | Dépendent d'un `cash_flow_category` correctement renseigné sur les comptes contrepartie | Non bloquant — comportement explicite et honnête par construction ; à surveiller à mesure que le plan comptable réel grandit |
| Rapprochement bancaire (2D), amortissements (2E), etc. | Pas encore construits | Suivre l'ordre §0.6 du plan Phase 2 |

## 12. Prochaine étape

**Je m'arrête ici pour votre validation**, comme demandé. Phase 2B est
livrée avec preuve : 297/297 tests verts (reconciliés fichier par
fichier suite à une limitation d'infrastructure documentée, jamais un
échec métier réel), génération PDF vérifiée indépendamment par script
direct contre les RPC live, un défaut réel trouvé et corrigé (pas
dissimulé) plus une fausse alerte auto-corrigée avant livraison,
typecheck/lint/build propres, `git status` propre. **Aucune ligne de
Phase 2C n'a été commencée** — j'attends votre confirmation avant de
démarrer.
