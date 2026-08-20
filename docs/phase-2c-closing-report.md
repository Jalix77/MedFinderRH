# Phase 2C — Tiers & Facturation — Rapport de clôture consolidé

> **Statut : EN ATTENTE DE VOTRE VALIDATION.** Les 5 jalons (2C.1, 2C.2,
> 2C.3A, 2C.3B, 2C.4) ont été approuvés et clôturés individuellement.
> Ce document consolide l'ensemble avant de déclarer Phase 2C CLOSED.
> **Aucune ligne de Phase 2D n'a été commencée.**

---

## 1. Ce qui est TERMINÉ, jalon par jalon

| Jalon | Périmètre | Commit | Statut |
|---|---|---|---|
| **2C.1** | Référentiel de tiers + liaison fournisseur aux dépenses | `db06f82` | ✅ Clôturé |
| **2C.2** | Socle documentaire de facturation, **sans** comptabilisation | `918e06c` | ✅ Clôturé |
| **2C.3A** | Émission comptable des factures et avoirs | `8925e9d` | ✅ Clôturé |
| **2C.3B** | Encaissements clients, soldes et `cash_movements` | `f66495f` | ✅ Clôturé |
| **2C.4** | Écrans tiers/facturation, PDF, exports | `6960fe7` | ✅ Clôturé |

Un commit préalable, hors jalon, corrige un défaut signalé par le
Security Advisor réel pendant la clôture de 2B : `c4b1c4c`
(`function_search_path_mutable`, voir §10).

### 2C.1 — Tiers
Référentiel **unique** `third_parties` (identité canonique), rôles
`is_customer`/`is_supplier` portés par la table elle-même — choix motivé
par la RLS, qui doit arbitrer `customer.manage` vs `supplier.manage`
**au moment même de l'INSERT**, ce qu'une table enfant (insérée après le
parent) ne permettrait pas de garantir. Tables enfants simples
`third_party_contacts` et `third_party_addresses`. NIF unique par
organisation, insensible à la casse (index partiel : plusieurs tiers
sans NIF restent possibles).

`expense_requests.supplier_id` ajouté **nullable et définitivement
facultatif** ; `payee_name`/`payee_reference` **conservés** comme photo
historique du bénéficiaire. Aucune dépense existante modifiée ni
rétro-liée.

### 2C.2 — Documents de facturation
Modèle documentaire **unifié** : facture et avoir sont le même document
(`document_type = INVOICE | CREDIT_NOTE` + `credited_invoice_id`), avec
**numérotation séparée**. Calcul **déterministe côté serveur** :
`line_subtotal`/`tax_amount`/`line_total` sont des **colonnes générées**
— un client ne peut pas imposer un montant ; les totaux d'en-tête sont
recalculés par trigger. `tax_rate_percent` est un **instantané** :
modifier un taux plus tard ne réécrit jamais un document établi.
**Aucune comptabilisation à ce jalon** (vérifié par comptage avant/après).

### 2C.3A — Comptabilisation
Émission atomique : validation → SoD → numéro → taux figé → écriture →
statut `issued`, **dans une seule transaction**. Facture : Dr Créances /
Cr Produits [/ Cr Taxe]. Avoir : sens strictement inverse, avec
**plafond cumulatif** contrôlé sous verrou de la facture d'origine.
Comptes résolus **par configuration** (tiers → défaut organisation →
erreur explicite) — aucun code `1100`/`4000` dans une RPC.

### 2C.3B — Encaissements
Encaissement atomique : verrou facture → contrôle solde → écriture
Dr Trésorerie / Cr Créances → `cash_movement direction='in'` → paiement.
Solde **dérivé et vérifiable** : `amount_paid` est toujours recalculé
comme la somme des paiements `recorded`, jamais incrémenté aveuglément ;
`balance_due` en dérive par colonne générée. Statuts
`issued → partially_paid → paid` pilotés exclusivement par le serveur.

### 2C.4 — UI / PDF / exports
8 routes, PDF facture/avoir, exports CSV, recherche/filtres/pagination,
affichage des montants documentaires **et** HTG fonctionnels historiques.
Aucune règle métier réimplémentée côté UI : chaque transition délègue à
la RPC correspondante.

---

## 2. Migrations (10)

| # | Fichier | Nature |
|---|---|---|
| 1 | `20260824090001_fix_search_path_chart_of_accounts_trigger.sql` | Correctif Advisor (pré-2C) |
| 2 | `20260825090001_third_parties.sql` | 2C.1 |
| 3 | `20260825090002_expense_requests_supplier_link.sql` | 2C.1 |
| 4 | `20260826090001_invoicing_documents.sql` | 2C.2 |
| 5 | `20260826090002_invoicing_document_rpcs.sql` | 2C.2 |
| 6 | `20260827090001_invoice_accounting_posting.sql` | 2C.3A |
| 7 | `20260827090002_fix_post_document_helper_return.sql` | **Correctif** 2C.3A |
| 8 | `20260828090001_customer_payments.sql` | 2C.3B |
| 9 | `20260828090002_fix_payment_link_immutability.sql` | **Correctif** 2C.3B |
| 10 | `20260828090003_payment_links_set_at_insert.sql` | **Correctif structurel** 2C.3B |

**Toutes additives.** Aucune table supprimée, aucune colonne retirée,
**aucune contrainte CHECK existante modifiée ni élargie**. Seule
exception assumée et répétée : `app_private.seed_default_numbering_sequences()`
est **redéfinie en cumulatif** à chaque jalon qui ajoute un type de
numérotation — patron déjà appliqué en 1B/1C/2A, avec reproduction à
l'identique des motifs antérieurs (verrouillé par test).

### 2.1 — MIGRATIONS CORRECTIVES QUI N'ONT PAS PRIS EFFET DU PREMIER COUP

Point demandé explicitement, conservé pour l'historique.

**Cas n°1 — `20260827090002` (2C.3A).** Appliquée une première fois et
annoncée « appliquée », mais **sans effet** : le comportement erroné
persistait à l'identique. Plutôt que de relancer à l'aveugle, l'état
réel de la fonction en base a été interrogé
(`prosrc like '%perform app_private.post_journal_entry%'` → **`false`**),
prouvant que l'ancien corps était toujours actif. La migration a alors
été **réémise en version auto-vérifiante** : un bloc `DO` final lève une
exception explicite si le corps n'a pas été remplacé ou si le
confinement du helper est rompu.

**Cas n°2 — `20260828090002` (2C.3B).** Même symptôme, deuxième
occurrence. Diagnostic par **isolation du trigger hors RPC** :
`INSERT` OK / `UPDATE notes` OK / `UPDATE journal_entry_id (NULL→valeur)`
**REFUSÉ** — preuve directe que l'ancienne version était encore active,
malgré le « success » annoncé.

**Décision prise à la suite du cas n°2** : ne plus dépendre de
l'application d'un correctif de trigger. La migration `20260828090003`
**supprime la cause** au lieu d'assouplir la garde — l'identifiant du
paiement est généré en amont, si bien que l'écriture et le mouvement
sont créés **avant** le paiement, qui naît déjà rattaché. Résultat :
plus aucun `UPDATE`, immutabilité **plus stricte** qu'avec le correctif
initial, et fonction **correcte quelle que soit la version du trigger
réellement installée**.

**Conséquence pour l'exploitation** : `20260828090002` est désormais
**sans effet fonctionnel** (son assouplissement n'est plus sollicité).
Elle est conservée dans l'historique des migrations pour ne pas réécrire
la chronologie, mais l'état de référence est celui de `20260828090003`.

**Leçon retenue et appliquée** : depuis le cas n°1, **toute migration
corrective embarque une auto-vérification** qui échoue bruyamment si
elle n'a pas pris effet.

---

## 3. RPC

**Publiques** (`security definer`, `search_path` fixe, `revoke all from
public` + `grant execute to authenticated`, refus en
`{success:false,error:'…'}` pour préserver la trace d'audit « denied ») :

| RPC | Jalon |
|---|---|
| `submit_invoice_document` | 2C.2 |
| `issue_invoice_document` | 2C.2, étendue en 2C.3A (comptabilisation) |
| `cancel_invoice_document` | 2C.2, étendue en 2C.3A (contre-passation) |
| `request_invoice_issue_exception` | 2C.2 |
| `validate_invoice_issue_exception` | 2C.2 |
| `record_customer_payment` | 2C.3B |
| `cancel_customer_payment` | 2C.3B |

**Internes, confinées à `app_private`** — `revoke` explicite,
**aucun `grant` à `anon` ni `authenticated`**, `set search_path = ''` :

- `post_document_journal_entry` — helper multi-lignes. **Jamais exposé
  via PostgREST** (vérifié : `PGRST202` en anon, et test dédié). Aucun
  chemin ne permet à un utilisateur de poster des lignes comptables
  arbitraires : les lignes sont construites par les RPC métier **après**
  validation.
- `recalculate_invoice_totals`, `recalculate_invoice_payment_state`,
  `enforce_invoice_consistency`, `enforce_invoice_line_consistency`,
  `enforce_third_party_child_org_consistency`,
  `enforce_expense_supplier_consistency`,
  `third_parties_immutable_if_used`, `invoices_immutable_once_issued`,
  `invoice_lines_immutable_once_issued`,
  `customer_payments_immutable_once_recorded`, `set_third_party_code`.

---

## 4. RLS

Toutes les nouvelles tables ont RLS activée, avec `(select auth.uid())`
systématique (évite la régression `auth_rls_initplan` corrigée en 1C).

| Table | Lecture | Écriture | Suppression |
|---|---|---|---|
| `third_parties` | `customer.manage` **ou** `supplier.manage` | idem, **avec cohérence de rôle** (une fiche `is_customer` exige `customer.manage`) | **Aucune policy** |
| `third_party_contacts` / `_addresses` | hérite du tiers | idem | autorisée |
| `tax_rates` | `invoice.manage` ou `accounting.view` | `invoice.manage` | autorisée |
| `invoices` | `invoice.manage` ou `accounting.view` | `invoice.manage` **et statut modifiable** | **uniquement** si non émis |
| `invoice_lines` | idem | `invoice.manage` | via trigger d'immutabilité |
| `invoice_issue_approvals` | lecture seule | **RPC exclusivement** | — |
| `customer_payments` | `payment.record`, `accounting.view` ou `invoice.manage` | **aucune policy — RPC exclusivement** | **aucune policy** |

L'anti-IDOR ne repose **jamais** sur un filtre organisationnel réécrit
dans les pages : `has_permission` appelle d'abord `is_active_member`,
donc un `p_org_id` ou un identifiant d'une autre organisation échoue
avant tout accès. Écrire un second filtre côté page créerait une seconde
autorité — délibérément évité.

---

## 5. Permissions

**Aucune permission créée.** Les cinq utilisées existaient déjà au
catalogue RBAC depuis la Phase 1A :

`customer.manage` · `supplier.manage` · `invoice.manage` ·
`payment.record` · `accounting.reverse` (exigée en plus pour toute
annulation contre-passant une écriture).

---

## 6. Séparation des fonctions (SoD)

Le **créateur d'un document ne peut pas l'émettre**. Garde d'**acteur**
(pas une permission distincte), mécanisme identique à
`approve_manual_journal_entry` de Phase 2A.

**Exception formelle** : `request_invoice_issue_exception` (justification
obligatoire) puis `validate_invoice_issue_exception`, réservée à un
**DIRECTEUR_GENERAL ou SUPER_ADMIN**, jamais au demandeur — contrainte
en base (`exception_requested_by <> exception_validated_by`) et vérifiée
en RPC. Tracée en audit.

Seconde séparation, structurelle : **émettre** (`invoice.manage`) et
**encaisser** (`payment.record`) sont deux permissions distinctes,
attribuables à deux personnes différentes.

---

## 7. Multi-devise

HTG et USD. Taux **figé à l'émission**, jamais réévalué rétroactivement.
`total_htg` est une **colonne générée** — la contre-valeur fonctionnelle
HTG est donc historique par construction. Contrainte
`currency <> 'HTG' or exchange_rate_to_htg = 1`.

Un **avoir hérite obligatoirement de la devise** de la facture créditée.
Un **paiement doit être dans la devise de la facture** (HTG→HTG,
USD→USD) **et** cohérent avec le compte de trésorerie — refus
`currency_mismatch` sinon. **Aucun écart de change n'est donc générable
en Phase 2C.**

---

## 8. Immutabilité

Gardes posées **au niveau base**, donc opposables à **tous** les chemins
privilégiés applicatifs — Server Action, Route Handler, script
d'administration et **`service_role` inclus**. Aucun code applicatif ne
peut les contourner puisqu'elles ne sont pas dans le code applicatif.

| Objet | Règle |
|---|---|
| Document émis | Contenu financier figé ; seuls statut, `amount_paid` et champs d'annulation évoluent |
| Lignes d'un document émis | INSERT/UPDATE/DELETE refusés |
| Document émis | **DELETE destructif refusé** ; brouillon reste supprimable |
| Encaissement comptabilisé | Contenu financier figé ; **DELETE refusé** |
| Liens `journal_entry_id`/`cash_movement_id` | Figés **dès l'insertion** (§2.1, cas n°2) |
| Tiers utilisé en comptabilité | Suppression refusée (colonne polymorphe sans FK possible) ; désactivation seule |
| Écriture comptabilisée | Immuable depuis 1C — non modifiée par 2C |

**Correction par avoir ou contre-passation, jamais par réécriture
silencieuse.** Vérifié **dans les deux sens** : un brouillon reste
modifiable et supprimable, les notes restent ouvertes après émission —
la garde ne sur-bloque pas.

---

## 9. Tests

### 9.1 — Suites Phase 2C

| Suite | Tests |
|---|---:|
| `third-parties.test.ts` (2C.1) | 27 |
| `invoicing-documents.test.ts` (2C.2) | 47 |
| `invoice-accounting.test.ts` (2C.3A) | 36 |
| `customer-payments.test.ts` (2C.3B) | 34 |
| `invoicing-ui.spec.ts` (2C.4, E2E) | 8 |
| **Total Phase 2C** | **152** |

Dernières exécutions : **144/144** (4 suites d'intégration 2C ensemble),
**8/8** (E2E 2C.4).

### 9.2 — Couverture qualitative

Structure et contraintes · calcul déterministe (y compris refus d'un
montant imposé par le client) · devise HTG/USD et contre-valeur
historique · numérotation distincte facture/avoir · workflow complet ·
**SoD et exception validée DG** · comptes non résolus → refus explicite ·
**atomicité** (échec comptable ⇒ aucun document émis, aucun paiement,
aucun mouvement) · **idempotence** · **concurrence** (3 appels simultanés
d'émission ; 2 et 3 encaissements simultanés ; 2 avoirs simultanés) ·
plafond cumulatif d'avoir · surpaiement · auxiliaire `third_party_id` ·
période clôturée · immutabilité **via `service_role`** · **RLS/IDOR** ·
helper `app_private` non exposé et sans grant · `search_path` ·
intégration au reporting 2B (journal général, grand livre, flux de
trésorerie).

### 9.3 — Vérifications explicitement demandées

- Facture `issued` ⇒ **exactement une** écriture d'origine.
- Facture `cancelled` ⇒ origine **+** contre-passation, **effet net nul**,
  sans double posting (une seconde annulation est refusée).
- **Exactement une** écriture et **un** `cash_movement` par encaissement.
- Lien exact paiement ↔ facture ↔ écriture ↔ mouvement, organisation
  cohérente sur les quatre objets.

---

## 10. Non-régressions

| Suite | Résultat |
|---|---|
| `accounting-core`, `manual-journal-entries` | ✅ |
| `financial-statements-reconciliation` (invariants 2B) | ✅ |
| `treasury`, `third-parties`, `search-path-hardening`, `ui-permissions` | ✅ |
| **E2E complet** | **30/30 en une seule passe continue** |
| typecheck · lint · build | **0 · 0 · 30 routes** |

Dernières mesures : **49/49** (comptabilité/reporting/permissions),
**144/144** (suites 2C), **30/30** (E2E).

**Deux tests antérieurs mis à jour, en toute transparence** :
- Deux tests 2C.2 encodaient une frontière **temporaire** du jalon
  (« l'émission ne comptabilise pas », « `tax_rates` est vide »). Le
  premier est devenu faux **par conception** avec 2C.3A ; le second ne
  peut plus tenir car un taux utilisé devient insupprimable. Ils
  vérifient désormais les invariants **durables** : un brouillon n'a
  aucun impact comptable, et la migration ne seede aucun taux.
- Un test 2C.1 piochait une ligne d'écriture **au hasard** ; depuis
  2C.3A/2C.3B la plupart sont comptabilisées donc immuables, et il
  échouait pour une raison sans rapport avec ce qu'il vérifie. Il crée
  désormais sa propre écriture en brouillon.

---

## 11. Security Advisor et `search_path`

**Rappel structurant** : les vérifications internes `debug_*` **ne valent
pas** le Security Advisor Supabase. Preuve factuelle obtenue pendant la
clôture de 2B — elles affichaient « 0 » alors que l'Advisor réel a
signalé `app_private.chart_of_accounts_immutable_if_used`. Cause :
`debug_security_definer_without_search_path` filtrait sur `prosecdef`,
donc une fonction **trigger ordinaire** était hors de son champ.

Trou fermé par `public.debug_functions_with_mutable_search_path` (sans
filtre `prosecdef`) + `tests/integration/search-path-hardening.test.ts`.

**Toutes les fonctions Phase 2C sont écrites avec `search_path` fixe dès
l'origine** — leçon appliquée d'emblée, jamais rattrapée après coup.
Contrôle vert sur `public` et `app_private` à chaque jalon.

**Attendu au prochain rejeu de l'Advisor** : Phase 2C ajoute **7 RPC
publiques `SECURITY DEFINER`**, donc environ **7 avertissements
`authenticated_security_definer_function_executable` supplémentaires**.
Ils sont **intentionnels et audités** (§3, §4) : ni passage en
`SECURITY INVOKER`, ni révocation de `authenticated` pour faire
disparaître le warning. **Un rejeu de l'Advisor par vous reste requis
pour confirmer** — je n'affirmerai jamais « 0 warning ».

---

## 12. Dette Phase 2B — CLÔTURÉE

Le verrou E2E de Phase 2B (« 22/22 en une passe propre »), **non obtenu
à l'époque**, a été levé pendant 2C.4 : **30/30 en une seule exécution
continue**, incluant les suites historiquement instables
(`treasury-workflow`, `mobile-nav`). Critère **satisfait et dépassé**
(30 tests contre 22). Aucun code métier modifié, aucun timeout gonflé.

`docs/phase-2b-closing-report.md` est mis à jour en conséquence, **sans
réécriture d'historique** : le §H.1 dit explicitement que le 22/22
n'avait pas été obtenu à l'époque, le §H.2 documente la preuve
ultérieure. Phase 2B est marquée **CLOSED**.

---

## 13. Ce qui reste HORS SCOPE

- ❌ Rapprochement bancaire détaillé → **Phase 2D** (`cash_movements.reconciled` existe, **non exploité**)
- ❌ Immobilisations / amortissements → Phase 2E
- ❌ Prêt FDI → Phase 2F
- ❌ Dons & subventions supplémentaires → Phase 2-bis
- ❌ Refonte UX générale → phase dédiée
- ❌ **Facturation fournisseur autonome** — décision arbitrée n°1 : le
  passif fournisseur transite déjà par `expense_requests` ; un second
  circuit provoquerait un **double comptage des charges**
- ❌ **Paiement cross-currency** et écarts de change réalisés
- ❌ Devis, commandes, bons de livraison
- ❌ Relances automatiques
- ❌ **Saisie d'un encaissement depuis l'écran** — le scope 2C.4
  autorisait la « visualisation des paiements », pas leur enregistrement.
  Les statuts `partially_paid`/`paid` sont donc **affichés** mais
  atteignables uniquement par RPC (voir §14)

---

## 14. Dettes techniques résiduelles

| # | Dette | Gravité | Détail |
|---|---|---|---|
| 1 | **Encaissement non saisissable à l'écran** | 🟡 Moyen | Le backend est complet et testé (34/34), mais aucun formulaire ne l'expose. Un utilisateur ne peut pas encaisser depuis l'application. **Choix de périmètre assumé**, à lever par un jalon UI court |
| 2 | Migration `20260828090002` sans effet fonctionnel | 🟢 Faible | Conservée pour ne pas réécrire la chronologie ; l'état de référence est `20260828090003` (§2.1) |
| 3 | Avoir : pas de contrôle du cumul **à la saisie** | 🟢 Faible | Le plafond est vérifié **à l'émission** (sous verrou). L'écran ne prévient pas en amont — refus tardif mais jamais incorrect |
| 4 | Tiers : contacts et adresses non éditables à l'écran | 🟢 Faible | Tables et RLS livrées en 2C.1 ; aucun écran ne les expose encore |
| 5 | Pas d'export PDF du relevé client / balance âgée | 🟢 Faible | `generate_customer_statement_report` était prévu au plan (§4.3) et **n'a pas été livré** — hors des scopes autorisés des jalons |
| 6 | Quota de connexions Supabase Auth du projet démo | 🟡 Moyen | Hérité de 2B. Un rejeu monolithique de la suite d'intégration complète peut encore l'épuiser ; sans rapport avec le code |

---

## 15. Données de test inertes laissées volontairement en base

Point demandé explicitement, conservé pour l'historique.

**a) 32 documents émis pendant la fenêtre 2C.2** — 29 `INVOICE` (dont 2
annulées) et 3 `CREDIT_NOTE`, tous dans **Organisation A**, numéros
`FAC-2026-0001`→`0029` et `AV-2026-0001`→`0003`. Tous rattachés au tiers
`[TEST-FIXTURE] Client client-principal`. **Origine : 100 % fixtures de
test, 0 donnée métier** (pré-contrôle du 19/08/2026).

**Ils ne portent AUCUNE écriture comptable** — vérifié :
`journal_entries` avec `source_type='invoice'` = **0** à ce moment-là.
Ils n'apparaîtront donc **jamais** dans un état financier. **Option 1
retenue et validée par vous** : aucun backfill, aucune suppression
forcée, aucun contournement du trigger d'immutabilité.

**b) 1 facture `DIAG-…` + 1 encaissement `DIAGP-…`** créés par un
diagnostic isolé pendant 2C.3B (pour prouver, hors RPC, quel `UPDATE` le
trigger refusait). Le paiement est insupprimable par conception. Signalé
au moment de sa création plutôt que laissé passer.

**c) Fixtures accumulées par les suites de tests** — tiers, comptes,
documents émis et encaissements comptabilisés. Les **documents émis et
les écritures comptabilisées ne peuvent jamais être nettoyés** (c'est la
garantie d'immutabilité elle-même), donc `FixtureRegistry` échoue
silencieusement sur eux. **Conséquence méthodologique appliquée** :
aucune assertion de Phase 2C ne porte sur un **agrégat cumulatif** de
l'organisation — toujours sur un document ou un paiement **précis** et
sur **ses propres** objets. C'est la leçon directe de Phase 2B.

---

## 16. Risques connus

| Risque | Gravité | Mitigation en place |
|---|---|---|
| Warnings `SECURITY DEFINER` supplémentaires à l'Advisor | 🟡 | Intentionnels, audités (§11). Rejeu Advisor par vous requis |
| Volume de documents de test dans Organisation A | 🟢 | Inertes comptablement ; assertions jamais cumulatives (§15) |
| Flux `UNCLASSIFIED` au flux de trésorerie 2B | 🟢 | Dépend de `cash_flow_category` sur les comptes contrepartie ; comportement explicite, jamais deviné |
| Encaissement non exposé à l'écran | 🟡 | Dette n°1 (§14) — backend complet, UI à ajouter |
| Instabilité réseau du projet cloud partagé | 🟡 | Diagnostiquée par mesure directe à chaque occurrence, jamais supposée |

---

## 17. Critères pour déclarer Phase 2C CLOSED

| # | Critère | État |
|---|---|---|
| 1 | Les 5 jalons approuvés individuellement | ✅ Fait |
| 2 | 10 migrations additives, aucune contrainte existante affaiblie | ✅ Fait |
| 3 | 152 tests Phase 2C verts | ✅ Fait |
| 4 | Non-régressions comptabilité/reporting/permissions | ✅ Fait |
| 5 | E2E complet en une passe continue | ✅ **30/30** |
| 6 | typecheck / lint / build propres | ✅ Fait |
| 7 | `search_path` : 0 fonction mutable | ✅ Fait |
| 8 | `git status` propre, commits atomiques par jalon | ✅ Fait |
| 9 | Dette E2E Phase 2B levée | ✅ Fait (§12) |
| 10 | **Rejeu du Security Advisor par vous**, décompte par catégorie | ⏳ **REQUIS** |
| 11 | **Votre validation de ce rapport consolidé** | ⏳ **REQUIS** |

**Il reste donc deux conditions**, toutes deux de votre ressort : le
rejeu de l'Advisor (pour confirmer les ~7 warnings attendus et vérifier
qu'aucun avertissement inattendu n'apparaît) et votre validation de ce
document.

---

**Je m'arrête ici. Aucune ligne de Phase 2D n'a été commencée.**
