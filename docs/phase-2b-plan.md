# Phase 2B — États financiers — Plan validé (17/08/2026)

Statut : **PLAN VALIDÉ PAR JEAN ALIX PIERRE, 13 ajustements intégrés
ci-dessous avant le premier commit de code** (même discipline que
`docs/phase-1c-plan.md`/`docs/phase-2-plan.md`). **Phase 2B est
autorisée à démarrer.** Aucune ligne de Phase 2C n'a été commencée.

## 0. Principe directeur (rappel, non négociable)

Les six états sont dérivés **exclusivement** de `journal_entries`/
`journal_entry_lines` en statut `posted`. **Aucun chiffre financier
n'est repris directement** depuis `expense_requests`, `grants`,
`invoices` (2C, pas encore construit), ou `cash_movements` — y compris
pour le flux de trésorerie (correction actée, voir §6). Si une donnée
n'existe pas dans le grand livre posté, elle n'existe pas dans un état
financier de Phase 2B, point final.

## 1. Périmètre exact

6 états en lecture seule, générés à la demande, jamais stockés :
journal général, grand livre, balance générale, compte de résultat,
bilan, flux de trésorerie (méthode directe — voir §6). Aucune nouvelle
table de données métier, aucune saisie, **aucune écriture de clôture
d'exercice formelle** (le résultat non affecté reste calculé à la
volée, jamais comptabilisé automatiquement — §5).

**Une extension de schéma minimale est nécessaire** (annoncée dès
maintenant, détaillée §6) : `chart_of_accounts.cash_flow_category`,
pour la classification configurable des flux de trésorerie exigée par
Jean Alix Pierre. C'est la seule colonne ajoutée dans tout Phase 2B —
aucune nouvelle table.

## 2. Journal général

**Colonnes** : période, journal, numéro d'écriture, date, référence
(dérivée de `source_type`/`source_id` — rendue lisible, ex. "Dépense
DEP-2026-0237", sans nouvelle colonne), libellé (`description`),
compte (code + libellé), débit, crédit, source métier (`source_type`),
centre de coût quand présent (`cost_center_id`, sinon "Non affecté").

**Filtres** : période **ou** journal (filtres au niveau de
l'**écriture**, jamais du compte — voir garde ci-dessous). **Aucun
filtre par compte sur cet état** : un filtre par compte ne montrerait
que certaines lignes de certaines écritures, cassant la complétude
nécessaire à l'invariant débit=crédit (c'est précisément le grand livre,
§3, qui est la vue centrée-compte). Ce choix de conception élimine
structurellement le piège signalé par Jean Alix Pierre plutôt que de le
documenter comme une exception à surveiller.

**Invariant testé** : `Σ débit = Σ crédit` sur tout ensemble filtré par
période/journal (filtres d'écriture complète) — **jamais revendiqué**
si un filtre de granularité ligne (compte, centre de coût) était ajouté
à l'avenir sans revoir cette garantie.

## 3. Grand livre

**Par compte** : solde d'ouverture, mouvements de la période (lignes
détaillées débit/crédit), solde progressif (calculé ligne par ligne,
chronologique), solde de clôture.

**Solde d'ouverture** : `Σ (debit − credit)` de **toutes** les lignes
d'écritures postées dont `entry_date < p_period_start`, pour ce compte
— **jamais recalculé depuis les seuls mouvements de la période**, lu
sur l'historique complet à chaque appel (aucune table de soldes
pré-agrégés, pas de risque de désynchronisation).

**Solde de clôture** = solde d'ouverture + Σ mouvements de la période
(cohérence arithmétique interne testée explicitement).

## 4. Balance générale

**Par compte** : solde d'ouverture, total débit période, total crédit
période, solde de clôture (débiteur ou créditeur).

**Représentation retenue** (précisée explicitement, comme demandé) :
chaque compte porte un `solde_brut = debit_total − credit_total`
(signe **cohérent pour tous les comptes**, jamais inversé par type) —
c'est ce nombre dont la somme algébrique sur tous les comptes est
**mathématiquement nulle** (conséquence directe de l'invariant
`debit = credit` déjà garanti au posting depuis 1C.1, pas une
coïncidence à vérifier au cas par cas). Un second champ `solde_normal`
(positif) et un `sens` (`débiteur`/`créditeur`) sont dérivés de
`solde_brut` selon le type de compte, **uniquement pour l'affichage**
— jamais utilisés dans l'invariant de somme nulle.

**Invariants testés** :
- `Σ mouvements débit période = Σ mouvements crédit période` (tous
  comptes confondus).
- `Σ solde_brut de clôture (tous comptes) = 0`.
- Grand livre ↔ balance générale : solde de clôture identique, compte
  par compte, à montant et à centime près.

## 5. Compte de résultat

**Porte sur une période** (`p_period_start`/`p_period_end`), pas une
date unique. Comptes `revenue`/`expense` uniquement. Signe dérivé par
la fonction centrale partagée `app_private.account_normal_balance()`
(§4 de la version précédente de ce plan, inchangé) — jamais
réimplémenté localement.

**Résultat net = Produits − Charges**, réconcilié exactement avec les
mêmes comptes dans la balance générale calculée sur la même période
(même RPC de balance générale appelée en interne pour la vérification,
jamais une deuxième formule).

**Garde explicite** : le résultat d'une période N'inclut **jamais**
les produits/charges dont `entry_date` tombe hors de
`[p_period_start, p_period_end]` — testé explicitement avec une fixture
portant des écritures avant/après la période demandée.

## 6. Bilan

**Calculé à une date donnée (`p_as_of_date`), jamais comme un rapport
`period_start → period_end`.** Inclut tous les mouvements postés
jusqu'à cette date, sans limite basse.

**Résultat de l'exercice non affecté** : ligne explicite, calculée en
appelant en interne la RPC du compte de résultat (§5) sur la plage
`[fiscal_year.start_date, p_as_of_date]` — **jamais une nouvelle
formule**. Équation :

```
Actif = Passif + Capitaux propres (comptes statutaires postés) + Résultat de l'exercice non affecté
```

**Absence de double comptage (exigence explicite)** : parce que le
résultat non affecté est strictement borné à l'exercice **courant**
(`fiscal_year.start_date → p_as_of_date`), tout résultat d'un exercice
**antérieur** déjà affecté aux capitaux propres par une écriture
comptable réelle (ex. virement manuel vers le compte 3000/3900 lors
d'une clôture passée) est automatiquement exclu de ce calcul — il fait
déjà partie du solde posté des comptes de capitaux propres statutaires,
compté une seule fois, à sa place naturelle. Aucune détection spéciale
requise : c'est une conséquence directe du bornage par date. Testé
explicitement avec une fixture simulant un exercice antérieur déjà
affecté.

## 7. Flux de trésorerie — méthode directe, classification configurable

**Méthode directe, explicitement** (pas indirecte, pas un mélange) :
chaque flux de trésorerie réel est un mouvement de ligne d'écriture
touchant un compte de trésorerie, classé selon la nature économique de
sa **contrepartie** — jamais un rapprochement du résultat net avec des
ajustements non-monétaires (ce que ferait la méthode indirecte, non
implémentée en 2B).

**Identification des comptes de trésorerie** (déjà approuvé, inchangé) :
`chart_of_accounts.id ∈ (gl_account_id de cash_accounts ∪ bank_accounts
∪ mobile_money_accounts)` — jamais un code compte codé en dur.

**Classification (nouveau, exigé)** : nouvelle colonne
`chart_of_accounts.cash_flow_category text check (in ('operating',
'investing', 'financing'))`, **nullable, configurable par le
comptable** via l'UI plan comptable existante (2A) — pas une nouvelle
table, pas une règle hors du plan comptable. Pour chaque écriture
touchant un compte de trésorerie :
- Si l'écriture ne touche qu'**un seul** compte de trésorerie et qu'au
  moins une contrepartie non-trésorerie porte une
  `cash_flow_category` renseignée → flux classé dans cette catégorie.
- Si les deux côtés de l'écriture sont des comptes de trésorerie
  (virement interne caisse↔banque) → **exclu** du détail par
  catégorie (un virement interne n'est pas un flux économique, il ne
  change pas le total trésorerie) — visible séparément comme "virement
  interne", jamais compté deux fois ni classé arbitrairement.
- Si la contrepartie n'a **aucune** `cash_flow_category` renseignée, ou
  si plusieurs contreparties de catégories différentes coexistent sur
  la même écriture sans classification unique possible → **`UNCLASSIFIED`**,
  **signalé explicitement** (jamais deviné, jamais absorbé
  silencieusement dans une autre catégorie).

**Seed de classification proposé pour les 18 comptes existants** (point
de départ raisonnable, entièrement modifiable ensuite) :

| Compte | Catégorie proposée |
|---|---|
| 1100 Créances clients | operating |
| 1500/1510 Immobilisations | investing |
| 1590 Amortissements cumulés | investing |
| 2100 Dettes fournisseurs | operating |
| 2200 Emprunt FDI | financing |
| 2900 Fonds affectés | operating |
| 3000 Capital / Apport fondateurs | financing |
| 4000/4010/4900 Revenus | operating |
| 6000/6100/6200/6800 Charges | operating |
| 1000/1010/1020 (trésorerie elle-même) | non applicable (jamais contrepartie d'elle-même) |
| 3900 Résultat de l'exercice | non classifié par défaut (rarement touché directement par une écriture de trésorerie) |

**Réconciliation exigée** :
```
Trésorerie d'ouverture + Σ flux nets (operating + investing + financing + UNCLASSIFIED) = Trésorerie de clôture
```
Trésorerie d'ouverture/de clôture calculées exactement comme le solde
d'ouverture/de clôture du grand livre (§3) pour l'ensemble des comptes
de trésorerie — **doit être identique au grand livre**, pas une
deuxième formule.

## 8. Devises

État officiel consolidé **exclusivement en HTG**, devise fonctionnelle
de l'organisation, en utilisant `exchange_rate_to_htg` **enregistré
historiquement sur chaque ligne** — jamais réévalué au taux courant
(ADR-006, inchangé). Un filtre `p_currency` optionnel offre une **vue
analytique** restreinte à une devise d'origine (sans conversion) — il
ne remplace jamais l'état fonctionnel consolidé, qui reste le seul état
"officiel" retourné par défaut sans ce paramètre.

## 9. Centres de coûts

Filtre disponible uniquement là où `journal_entry_lines.cost_center_id`
est réellement renseigné (colonne déjà persistée depuis 1C.3) — jamais
reconstruit après coup depuis `expense_requests.cost_center_id` ou tout
autre module métier, ce qui violerait le principe "le grand livre fait
foi" (§0). Lignes sans centre de coût affichées sous "Non affecté",
jamais exclues silencieusement.

## 10. RPC et sécurité

6 RPC `SECURITY DEFINER`, `search_path` fixe (`set search_path = public,
app_private`, même patron que toutes les RPC existantes) :
1. `generate_general_journal_report`
2. `generate_general_ledger_report`
3. `generate_trial_balance_report`
4. `generate_income_statement_report`
5. `generate_balance_sheet_report`
6. `generate_cash_flow_report`

Chacune : filtre `status = 'posted'` uniquement ; dérive
l'organisation de `p_org_id` **et** revérifie
`is_super_admin(auth.uid()) OR has_permission(auth.uid(), p_org_id,
'accounting.view')` avant tout calcul (jamais une confiance implicite
dans le paramètre) ; `revoke all ... from public` puis `grant execute
... to authenticated` uniquement — **jamais `service_role` exposé** à
un rôle applicatif ; toute requête interne filtre explicitement
`organization_id = p_org_id` en plus de la RLS déjà active sur les
tables sous-jacentes (défense en profondeur, même patron que
`generate_papej_report`).

**Tests obligatoires par RPC** : `anon` refusé (42501, `EXECUTE` absent
au niveau grant — même famille que `phase1c-anon-refusal.test.ts`),
EMPLOYE refusé (`not_authorized`, pas de `accounting.view`), SUPPORT
refusé (idem), acteur d'une autre organisation refusé/vide, COMPTABLE
autorisé (contrôle positif).

## 11. Exports — PDF et CSV

**Obligatoire pour les 5 états principaux** (journal général, grand
livre, balance générale, compte de résultat, bilan) **et pour le flux
de trésorerie**, puisque sa version complète (avec classification) fait
partie de ce périmètre 2B. PDF et CSV **appellent exactement la même
RPC que l'écran, avec exactement les mêmes filtres** — même patron
strict que `app/api/papej/[grantId]/rapport-pdf/route.ts` (Route
Handler dédié, `lib/pdf/*-report.ts` avec `pdf-lib`, `winAnsiSafe`
réutilisée). Aucun second calcul indépendant possible par construction.

## 12. Plan de tests — invariants de réconciliation (renforcé)

Fichier dédié `tests/integration/financial-statements-reconciliation.test.ts`,
hermétique dès le départ (`FixtureRegistry`). En plus des invariants
déjà prévus (journal général équilibré sur périmètre d'écritures
complètes, grand livre ↔ balance générale, balance générale Σ=0,
compte de résultat ↔ balance générale, bilan Actif=Passif+CP+Résultat,
flux de trésorerie ↔ grand livre, isolation multi-org, contre-passation
incluse sans traitement spécial) — **ajouts exigés par Jean Alix
Pierre, tous couverts** :

- Bilan à une date donnée avec écritures **antérieures à la période**
  demandée (prouve l'inclusion complète jusqu'à `p_as_of_date`, pas
  seulement la période "courante").
- Solde d'ouverture du grand livre non nul (fixture avec écritures
  avant `p_period_start`).
- Balance générale : ouverture/mouvements/clôture cohérents
  arithmétiquement (`clôture = ouverture + mouvements`).
- Résultat d'une période **n'incluant pas** les produits/charges hors
  période (fixture avec écritures avant et après la plage demandée).
- Exercice précédent déjà affecté aux capitaux propres, **sans double
  comptage** dans le résultat non affecté de l'exercice courant (§6).
- `Trésorerie d'ouverture + flux nets = Trésorerie de clôture`.
- Flux non classifiable → **`UNCLASSIFIED`** explicitement, jamais une
  classification devinée.
- **Même état écran/CSV/PDF sur les mêmes filtres** — comparaison
  directe des montants extraits du PDF (`pdf-parse`, même technique que
  `papej-pdf-export.spec.ts`) contre la réponse JSON de la RPC.
- Contre-passation incluse naturellement par ses lignes comptables
  (aucun traitement spécial requis, testé explicitement).
- Isolation multi-organisation sur les 6 RPC **et** sur les deux
  Route Handlers d'export (PDF/CSV).

**Rejeu complet en une seule passe continue avant toute clôture** —
même exigence non négociable qu'en 2A.

## 13. Critères de clôture (inchangés, rappelés)

Migration (colonne `cash_flow_category` + seed + 6 RPC) appliquée et
vérifiée ; RLS/RBAC testées (positif/négatif/anon/autre organisation) ;
tous les invariants de réconciliation §12 verts en une seule passe
continue ; E2E (au moins un parcours par état, export PDF/CSV
vérifié) ; typecheck/lint/build propres ; recontrôle structurel Advisors
(`debug_security_definer_without_search_path`/
`debug_unwanted_function_grants`, même discipline qu'en 2A) ; scan
secrets propre ; `git status` propre ; `docs/phase-2b-closing-report.md` ;
puis **arrêt pour validation avant 2C**.

---

**Phase 2B est autorisée à démarrer sur cette base. Aucune ligne de
Phase 2C n'a été commencée et ne le sera pas avant validation
explicite.**
