# Phase 2C — Tiers & Facturation — Plan d'implémentation

> **Statut : PLAN SOUMIS À VALIDATION. Aucune migration, aucun code
> applicatif, aucun commit d'implémentation Phase 2C n'a été produit.**
>
> **Dette Phase 2B non mélangée** : le verrou E2E 22/22 reste une dette
> distincte, à régulariser dans sa propre fenêtre. Rien dans ce plan ne
> la masque ni ne la corrige.

---

## §0 — Principe directeur

Phase 2C ajoute un **référentiel de tiers** et un **cycle de facturation
client** qui s'insèrent dans le moteur comptable existant **sans le
réécrire**. Toute écriture générée passe par les fonctions déjà
éprouvées en 1C/2A (`post_journal_entry`, `reverse_journal_entry`,
`find_period_for_date`, `next_number_internal`). Aucun second mécanisme
de numérotation, de comptabilisation ou d'immutabilité n'est créé.

**Migrations strictement additives** : aucune colonne supprimée, aucune
table renommée, aucune contrainte existante affaiblie.

---

## §1 — Inspection de l'existant (état réel vérifié, pas supposé)

### 1.1 Ce qui existe déjà et sera RÉUTILISÉ tel quel

| Élément | État vérifié | Conséquence pour 2C |
|---|---|---|
| **Permissions `customer.manage`, `supplier.manage`, `invoice.manage`, `payment.record`** | ✅ **Déjà seedées** au catalogue RBAC (`20260813100011`) | **Aucune nouvelle permission à créer** (§5) |
| Journaux **`SALES`** et **`PURCHASES`** | ✅ Déjà seedés par `seed_default_journals()` | Utilisés directement (§8) |
| Comptes **1100 Créances clients** (asset), **2100 Dettes fournisseurs** (liability), **4000/4010 Revenus** | ✅ Déjà seedés par `seed_default_chart_of_accounts()` | Comptes collectifs par défaut (§8) |
| `journal_entry_lines.third_party_type` (`'customer'`/`'supplier'`/`'employee'`) + `third_party_id` | ✅ **Colonnes déjà présentes**, **sans FK** | Point d'ancrage auxiliaire déjà prêt — décision §16-D |
| `journal_entry_lines.currency` + `exchange_rate_to_htg` | ✅ Déjà présentes | Multi-devise déjà structurellement supporté |
| `journal_entries.source_type` autorise **`'invoice'`** | ✅ Déjà dans la contrainte CHECK | **Aucune modification de contrainte** pour les factures |
| `cash_movements` : `direction='in'`, `reference_type='invoice'`, `reconciled`, `journal_entry_id` | ✅ Déjà supportés | Encaissements clients intégrés sans modifier la trésorerie |
| `post_journal_entry` | ✅ Valide déjà : statut `draft`, **période ouverte**, ≥2 lignes, **débit = crédit**, comptes valides/actifs/dans l'organisation | Multi-lignes déjà supporté à la comptabilisation |
| `reverse_journal_entry` | ✅ Gardée par `accounting.reverse` + justification obligatoire | Seul mécanisme d'annulation comptable (§9) |
| Moteur de numérotation + `next_number_internal` | ✅ Patron : redéfinir `seed_default_numbering_sequences()` avec la liste cumulée **+ backfill** des organisations existantes | Répliqué à l'identique (§2.6) |
| `cost_centers` | ✅ Existent, portés par `journal_entry_lines.cost_center_id` | Dimension analytique réutilisée |
| Patron RLS, triggers d'audit, `set_updated_at` | ✅ Établis | Répliqués sans variation |

### 1.2 Ce qui N'EXISTE PAS et doit être créé

| Manque | Constat |
|---|---|
| Table de tiers | **Aucune** table `third_parties`/`customers`/`suppliers` n'existe |
| **`expense_requests.supplier_id`** | ⚠️ **La colonne n'existe pas du tout.** `expense_requests` porte `payee_name` (NOT NULL) et `payee_reference`. Phase 2C doit **l'ajouter en nullable** |
| Factures, lignes, paiements, avoirs | Aucune table |
| Helper de comptabilisation **multi-lignes** | `create_and_post_two_line_entry` ne gère que **2 lignes**, sans `third_party_*` ni `cost_center_id` → insuffisant pour une facture avec taxe |
| Taxes | Aucune table, aucun taux — **rien de fiscal n'est codé en dur nulle part** (état à préserver) |
| Table de taux de change | Aucune — le taux est saisi **par transaction** (`exchange_rate_to_htg`) |
| Séquences de numérotation facture/avoir/paiement | Non seedées (`employee`, `journal_entry`, `expense` uniquement) |

---

## §2 — Nouvelles tables et colonnes

### 2.1 `public.third_parties` — référentiel unique clients/fournisseurs

Table **unique** (et non deux tables séparées) car un tiers peut être
**client ET fournisseur**, exigence explicite du périmètre.

| Colonne | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `organization_id` | uuid NOT NULL → `organizations` | Cloisonnement multi-organisation |
| `third_party_code` | text NOT NULL | Auto-assigné par trigger (`next_number_internal`, type `third_party`) |
| `legal_name` | text NOT NULL | Identité légale |
| `commercial_name` | text NULL | Nom commercial si différent |
| `is_customer` | boolean NOT NULL DEFAULT false | |
| `is_supplier` | boolean NOT NULL DEFAULT false | |
| `tax_id` | text NULL | **NIF / identifiant fiscal** — format **non contraint** (§15) |
| `legal_form` | text NULL | SA, SARL, individuel… (libre) |
| `email`, `phone` | text NULL | Contact principal |
| `address_line1`, `address_line2`, `city`, `department`, `country` | text NULL | Adresse principale (facturation) |
| `preferred_currency` | char(3) NOT NULL DEFAULT `'HTG'` | CHECK `in ('HTG','USD')` |
| `payment_terms_days` | integer NOT NULL DEFAULT 0 | Base du calcul d'échéance |
| `receivable_account_id` | uuid NULL → `chart_of_accounts` | Surcharge du compte collectif 1100 |
| `payable_account_id` | uuid NULL → `chart_of_accounts` | Surcharge du compte collectif 2100 |
| `is_active` | boolean NOT NULL DEFAULT true | **Désactivation, jamais suppression** si utilisé |
| `notes` | text NULL | |
| `created_at`/`updated_at`/`created_by`/`updated_by` | | Conventions existantes |

### 2.2 `public.third_party_contacts` — contacts multiples

`id`, `organization_id`, `third_party_id` (→ `third_parties`, ON DELETE
CASCADE), `full_name` NOT NULL, `role_title`, `email`, `phone`,
`is_primary` boolean, timestamps.

### 2.3 `public.tax_rates` — fiscalité **configurable, jamais codée en dur**

`id`, `organization_id`, `code` NOT NULL, `label` NOT NULL,
`rate_percent` numeric(6,3) NOT NULL CHECK `>= 0`,
`tax_account_id` uuid NOT NULL → `chart_of_accounts` (compte de taxe à
reverser), `is_active` boolean, timestamps.

> **Aucun taux n'est seedé.** Aucune TCA, aucun pourcentage haïtien
> présumé. Une facturation sans taxe fonctionne intégralement si aucun
> taux n'est configuré (`tax_rate_id` nullable sur les lignes).

### 2.4 `public.customer_invoices`

| Colonne | Type | Notes |
|---|---|---|
| `id`, `organization_id` | | |
| `invoice_number` | text NOT NULL | Assigné **à l'émission**, pas au brouillon (§7) |
| `third_party_id` | uuid NOT NULL → `third_parties` | Doit être `is_customer` (trigger, §3) |
| `status` | text NOT NULL DEFAULT `'draft'` | CHECK `in ('draft','issued','partially_paid','paid','cancelled')` |
| `invoice_date` | date NOT NULL | |
| `due_date` | date NOT NULL | Calculée depuis `payment_terms_days`, modifiable en brouillon |
| `currency` | char(3) NOT NULL DEFAULT `'HTG'` | CHECK `in ('HTG','USD')` |
| `exchange_rate_to_htg` | numeric(14,6) NOT NULL DEFAULT 1 | **Figé à l'émission, jamais réévalué** (§15) |
| `subtotal`, `tax_total`, `total` | numeric(14,2) NOT NULL DEFAULT 0 | Recalculés depuis les lignes en brouillon ; **figés à l'émission** |
| `amount_paid` | numeric(14,2) NOT NULL DEFAULT 0 | Maintenu par les RPC de paiement/avoir |
| `balance_due` | numeric(14,2) **colonne générée** `total - amount_paid` | Jamais désynchronisable |
| `cost_center_id` | uuid NULL → `cost_centers` | Défaut d'en-tête, surchargeable par ligne |
| `journal_entry_id` | uuid NULL → `journal_entries` | Écriture d'émission |
| `issued_at`/`issued_by`, `cancelled_at`/`cancelled_by`/`cancel_reason` | | Traçabilité |
| `notes`, `payment_terms_text` | text NULL | |
| timestamps + `created_by`/`updated_by` | | |

### 2.5 `public.customer_invoice_lines`

`id`, `organization_id`, `invoice_id` (→ `customer_invoices`,
**ON DELETE CASCADE uniquement tant que la facture est en brouillon** —
garanti par le trigger d'immutabilité §9), `line_number` smallint,
`description` NOT NULL, `quantity` numeric(14,3) NOT NULL CHECK `> 0`,
`unit_price` numeric(14,2) NOT NULL CHECK `>= 0`,
`revenue_account_id` uuid NOT NULL → `chart_of_accounts`,
`tax_rate_id` uuid NULL → `tax_rates`,
`line_subtotal`, `tax_amount`, `line_total` numeric(14,2) NOT NULL,
`cost_center_id` uuid NULL, timestamps.

### 2.6 `public.credit_notes` et `public.credit_note_lines`

Structure **miroir** de la facture (voir §16-C pour l'arbitrage
« table séparée » vs « `document_type` sur la facture ») :
`credit_note_number`, `third_party_id`, `invoice_id` **nullable**
(avoir rattaché à une facture précise, ou avoir général), `status`
(`'draft'`,`'issued'`,`'cancelled'`), montants, `currency` +
`exchange_rate_to_htg` **hérités de la facture d'origine si rattaché**,
`journal_entry_id`, `reason` NOT NULL.

### 2.7 `public.customer_payments` et `public.customer_payment_allocations`

**`customer_payments`** : `payment_number`, `third_party_id`,
`payment_date`, `amount` CHECK `> 0`, `currency`,
`exchange_rate_to_htg`, `treasury_account_type`
(`'cash'`/`'bank'`/`'mobile_money'`), `treasury_account_id`,
`status` (`'recorded'`/`'cancelled'`), `journal_entry_id`,
`cash_movement_id` → `cash_movements`, `notes`, timestamps.

**`customer_payment_allocations`** : `payment_id`, `invoice_id`,
`amount_allocated` CHECK `> 0`. Permet un **paiement partiel** et un
paiement couvrant **plusieurs factures**.

### 2.8 Colonne ajoutée à une table existante — **la seule**

```
alter table public.expense_requests
  add column supplier_id uuid null references public.third_parties (id) on delete restrict;
```

**Strictement additif et définitivement nullable** :
- `payee_name` / `payee_reference` sont **conservés tels quels** — ils
  restent la **photo (snapshot) historique** du bénéficiaire au moment
  de la dépense, y compris pour les dépenses ponctuelles sans fiche
  fournisseur ;
- `supplier_id` n'est **jamais** rendu obligatoire, ni maintenant ni
  plus tard ;
- aucune dépense existante n'est modifiée ni rétro-liée automatiquement ;
- `on delete restrict` : un fournisseur référencé par une dépense ne
  peut plus être supprimé physiquement (cohérent avec §9).

---

## §3 — Contraintes et index

### 3.1 Contraintes

| Objet | Contrainte |
|---|---|
| `third_parties` | `unique (organization_id, third_party_code)` ; `check (is_customer or is_supplier)` — un tiers ni client ni fournisseur est refusé ; `unique (organization_id, lower(tax_id)) where tax_id is not null` (index unique partiel) |
| `customer_invoices` | `unique (organization_id, invoice_number)` ; `check (due_date >= invoice_date)` ; `check (total = subtotal + tax_total)` ; `check (amount_paid >= 0 and amount_paid <= total)` ; `check (status <> 'draft' or journal_entry_id is null)` |
| `customer_invoice_lines` | `unique (invoice_id, line_number)` ; `check (line_subtotal = round(quantity * unit_price, 2))` ; `check (line_total = line_subtotal + tax_amount)` |
| `tax_rates` | `unique (organization_id, code)` ; `check (rate_percent >= 0 and rate_percent <= 100)` |
| `customer_payments` | `unique (organization_id, payment_number)` |
| `customer_payment_allocations` | `unique (payment_id, invoice_id)` ; somme allouée ≤ montant du paiement **et** ≤ solde de la facture → **vérifié en RPC** (§4), pas par CHECK (agrégat impossible en CHECK) |
| Cohérence organisation | Trigger `enforce_*_org_consistency` sur chaque FK inter-tables (patron `enforce_budget_line_org_consistency` déjà existant) : la ligne, sa facture et son tiers doivent partager `organization_id` |
| Type de tiers | Trigger : `customer_invoices.third_party_id` doit pointer un tiers **`is_customer = true`** ; `expense_requests.supplier_id` (si non nul) un tiers **`is_supplier = true`** |

### 3.2 Index

- `third_parties (organization_id)`, `(organization_id, is_customer) where is_customer`, `(organization_id, is_supplier) where is_supplier`, `(organization_id, is_active)`, index trigram/`lower(legal_name)` pour la recherche
- `third_party_contacts (third_party_id)`
- `customer_invoices (organization_id)`, `(third_party_id)`, `(organization_id, status)`, `(organization_id, due_date) where status in ('issued','partially_paid')` (relances), `(journal_entry_id)`
- `customer_invoice_lines (invoice_id)`, `(revenue_account_id)`, `(cost_center_id)`
- `customer_payments (organization_id)`, `(third_party_id)`, `(organization_id, payment_date)`
- `customer_payment_allocations (payment_id)`, `(invoice_id)`
- `credit_notes (organization_id)`, `(invoice_id)`
- **`expense_requests (supplier_id) where supplier_id is not null`** — index partiel, indispensable pour éviter un avertissement Performance Advisor « clé étrangère non indexée » (leçon Phase 1C)

---

## §4 — RPC nécessaires

Toutes : `security definer`, `set search_path = public, app_private`,
`revoke all from public` + `grant execute to authenticated`, retour
`jsonb {success:false, error:'...'}` en cas de refus (**jamais** une
exception, pour préserver la traçabilité « denied » établie en 1A).

### 4.1 Fonction interne partagée — **nouvelle brique centrale**

`app_private.create_and_post_multi_line_entry(p_org_id, p_journal_code,
p_entry_date, p_description, p_source_type, p_source_id, p_lines jsonb,
p_actor)`

- `p_lines` : tableau `{account_id, debit, credit, third_party_type,
  third_party_id, cost_center_id, currency, exchange_rate_to_htg}`
- Généralise `create_and_post_two_line_entry` (qui reste **inchangée**,
  toujours utilisée par les dépenses et PAPEJ) au cas **N lignes**, avec
  les dimensions auxiliaire et analytique.
- Réutilise `find_period_for_date`, `next_number_internal`, puis
  `app_private.post_journal_entry` → **période fermée, équilibre
  débit=crédit et validité des comptes restent contrôlés par le moteur
  existant, non réimplémentés**.

### 4.2 RPC de facturation

| RPC | Rôle | Permission |
|---|---|---|
| `create_customer_invoice` | Crée un brouillon (en-tête + lignes en un appel, transactionnel) | `invoice.manage` |
| `update_customer_invoice_draft` | Remplace en-tête + lignes **en brouillon uniquement** | `invoice.manage` |
| `issue_customer_invoice` | Attribue le numéro, fige taux et montants, **génère et comptabilise l'écriture**, passe à `issued` | `invoice.manage` |
| `cancel_customer_invoice` | Annulation **avec justification** — refusée si `amount_paid > 0` ; **contre-passe** l'écriture via `reverse_journal_entry` | `invoice.manage` |
| `create_credit_note` / `issue_credit_note` | Avoir (brouillon puis émission + écriture) ; impute le solde de la facture rattachée | `invoice.manage` |
| `record_customer_payment` | Enregistre l'encaissement + allocations, **génère l'écriture et le `cash_movement`**, met à jour `amount_paid` et le statut | `payment.record` |
| `cancel_customer_payment` | Annulation avec justification : contre-passe l'écriture, annule le mouvement, recalcule le statut de la facture | `payment.record` |

### 4.3 Lecture

Les listes/fiches sont lues **directement par RLS** (patron des modules
RH/dépenses), sans RPC de lecture. Une seule RPC de lecture est prévue :
`generate_customer_statement_report(p_org_id, p_third_party_id,
p_as_of_date)` — **relevé client / balance âgée**, gardée par
`invoice.manage` ou `accounting.view`.

> Les tiers (`third_parties`, `third_party_contacts`, `tax_rates`) sont
> créés/modifiés **directement en table via RLS** (comme
> `departments`/`employees`), sans RPC : aucune écriture comptable n'est
> générée par leur création, une RPC n'apporterait aucune garantie
> supplémentaire.

---

## §5 — Permissions

**Aucune nouvelle permission n'est créée.** Les quatre nécessaires sont
**déjà seedées** (vérifié) :

| Permission | Domaine | Attributions actuelles |
|---|---|---|
| `customer.manage` | ventes | COMPTABLE, DIRECTEUR_GENERAL, SUPER_ADMIN |
| `supplier.manage` | finance | COMPTABLE, SUPER_ADMIN |
| `invoice.manage` | ventes | COMPTABLE, SUPER_ADMIN |
| `payment.record` | ventes | COMPTABLE, SUPER_ADMIN |

**Séparation des fonctions** obtenue **sans nouvelle permission** :
émettre une facture (`invoice.manage`) et encaisser (`payment.record`)
sont deux permissions distinctes, attribuables à deux personnes
différentes. La consultation comptable des états reste sous
`accounting.view` (Phase 2B), déjà indépendante.

→ Voir **§16-B** : faut-il en plus interdire que le **créateur** d'une
facture soit son **émetteur** (SoD stricte façon écritures manuelles
2A) ? Décision à arbitrer.

---

## §6 — Politiques RLS

Patron identique à `expense_requests` (§1.1), pour **chaque** nouvelle
table :

| Table | SELECT | INSERT / UPDATE | DELETE |
|---|---|---|---|
| `third_parties` | `is_super_admin` OU `customer.manage` OU `supplier.manage` | idem (une fiche `is_customer` exige `customer.manage`, `is_supplier` exige `supplier.manage`) | **Aucune policy DELETE** → suppression impossible depuis un client ; désactivation via `is_active` |
| `third_party_contacts`, `tax_rates` | Hérite du tiers / `invoice.manage` | idem | Autorisé tant que non référencé |
| `customer_invoices`, `customer_invoice_lines` | `is_super_admin` OU `invoice.manage` OU `accounting.view` (lecture comptable) | `invoice.manage` **et** `status = 'draft'` (les transitions passent exclusivement par les RPC) | **Aucune policy DELETE** |
| `credit_notes`, `credit_note_lines` | idem factures | idem | **Aucune policy DELETE** |
| `customer_payments`, `customer_payment_allocations` | `is_super_admin` OU `payment.record` OU `accounting.view` | **Aucun INSERT/UPDATE direct** — RPC exclusivement | **Aucune policy DELETE** |

Toutes les policies filtrent sur `organization_id` via
`has_permission(auth.uid(), organization_id, …)`, qui vérifie
`is_active_member` en premier → **le cloisonnement multi-organisation
et l'anti-IDOR reposent sur le mécanisme déjà éprouvé**, non réinventé.

Toutes utilisent `(select auth.uid())` pour éviter la régression
`auth_rls_initplan` corrigée en Phase 1C (`20260816090016`).

---

## §7 — Workflow exact des factures

```
                   ┌──────────────► cancelled  (annulation justifiée,
                   │                             uniquement si amount_paid = 0,
                   │                             contre-passation de l'écriture)
   draft ──issue──► issued ──paiement partiel──► partially_paid ──solde──► paid
     │                 │                                │                    │
     │                 └────────────── avoir (credit note) ──────────────────┘
     │                                  (réduit le solde ; jamais de suppression)
     └── modification libre (en-tête + lignes), aucun numéro, aucune écriture
```

**Règles de transition :**

1. **`draft`** — modifiable librement. **Aucun numéro attribué**, aucune
   écriture comptable, aucun impact sur les états financiers 2B.
2. **`issue`** — attribue `invoice_number` (`next_number_internal`),
   **fige** `exchange_rate_to_htg` et les montants, génère **et
   comptabilise** l'écriture (§8.1). Refusé si : aucune ligne, total
   nul, tiers inactif ou non-client, **période comptable fermée**
   (contrôlé par `post_journal_entry`).
3. **`partially_paid` / `paid`** — pilotés **exclusivement** par
   `record_customer_payment` et les avoirs ; `status` et `amount_paid`
   ne sont jamais modifiables à la main.
4. **`cancelled`** — uniquement si `amount_paid = 0`, avec
   **justification obligatoire**, et **contre-passation** de l'écriture
   d'émission via `reverse_journal_entry`. Une facture déjà encaissée
   **ne peut pas** être annulée → **avoir obligatoire**.

---

## §8 — Écritures comptables générées par événement

Toutes en **partie double**, comptabilisées par le moteur existant.
`third_party_type = 'customer'` et `third_party_id` sont portés sur la
ligne de compte collectif → **comptabilité auxiliaire** exploitable.

### 8.1 Émission d'une facture — journal `SALES`, `source_type='invoice'`

| Sens | Compte | Montant | Auxiliaire |
|---|---|---|---|
| **Débit** | `third_parties.receivable_account_id` ou **1100 Créances clients** | `total` | `customer` / `third_party_id` |
| **Crédit** | `customer_invoice_lines.revenue_account_id` (une ligne par compte de produit) | `line_subtotal` | — |
| **Crédit** | `tax_rates.tax_account_id` (si taxe) | `tax_amount` agrégé par taux | — |

### 8.2 Encaissement client — journal `CASH` ou `BANK` selon le type de compte

| Sens | Compte | Montant | Auxiliaire |
|---|---|---|---|
| **Débit** | `gl_account_id` du compte de trésorerie (caisse/banque/mobile money) | montant encaissé | — |
| **Crédit** | compte client (1100 ou surcharge) | montant encaissé | `customer` / `third_party_id` |

**+ un `cash_movements`** : `direction='in'`,
`reference_type='invoice'`, `reference_id` = facture,
`journal_entry_id` renseigné → l'encaissement apparaît **nativement**
dans la trésorerie 1C et dans le **flux de trésorerie 2B**
(classification `operating` héritée du compte de contrepartie).

### 8.3 Avoir (note de crédit) — journal `SALES`

Exactement l'inverse de 8.1 (Débit produits + Débit taxe / Crédit
client). **Ce n'est pas une contre-passation technique** : c'est un
document commercial distinct, numéroté et traçable.

### 8.4 Annulation d'une facture non encaissée

**Aucune écriture nouvelle n'est écrite à la main** :
`reverse_journal_entry(journal_entry_id, justification)` — fonction
existante, gardée par `accounting.reverse` + justification obligatoire.

### 8.5 Annulation d'un encaissement

Contre-passation de l'écriture 8.2, annulation du `cash_movement`
associé, recalcul de `amount_paid` et du statut de la facture.

---

## §9 — Règles d'immutabilité et de correction

| Règle | Mécanisme |
|---|---|
| Une facture **émise** n'est jamais modifiable silencieusement | Trigger `customer_invoices_immutable_once_issued` (patron exact de `journal_entries_immutable_once_posted`) : hors `draft`, seules `amount_paid`, `status` et les champs d'annulation sont modifiables — toute autre modification lève une exception, **y compris via `service_role`** |
| Les **lignes** d'une facture émise sont figées | Trigger `customer_invoice_lines_immutable_once_issued` (patron `journal_entry_lines_immutable_once_posted`) : INSERT/UPDATE/DELETE refusés si la facture parente n'est plus en `draft` |
| **Aucune suppression destructive** | Aucune policy DELETE sur les documents ; correction par **avoir**, annulation par **contre-passation justifiée** |
| Un **tiers utilisé** n'est jamais supprimable | Trigger `third_parties_immutable_if_used` (patron exact de `chart_of_accounts_immutable_if_used`, **avec `set search_path = ''` dès l'écriture** — leçon du correctif `20260824090001`) : bloque le DELETE si le tiers est référencé par une facture, un avoir, un paiement ou une `expense_requests`. Désactivation (`is_active = false`) uniquement |
| Une **période fermée** bloque toute comptabilisation | Déjà garanti par `post_journal_entry` — aucune règle parallèle |
| L'écriture générée est **immuable une fois comptabilisée** | Déjà garanti depuis 1C |
| **Audit** | Trigger `audit_*` sur les 8 nouvelles tables (patron existant), plus la traçabilité applicative `write_audit_log` dans chaque RPC (émission, annulation, encaissement, avoir) |

---

## §10 — Écrans et routes

| Route | Contenu | Garde |
|---|---|---|
| `/tiers` | Liste des tiers : recherche (nom, code, NIF), filtres (client/fournisseur/actif), **pagination serveur** | `customer.manage` OU `supplier.manage` |
| `/tiers/nouveau` | Création d'une fiche | idem |
| `/tiers/[id]` | Fiche : identité, contacts, adresses, comptes collectifs, **encours client**, historique factures/paiements/dépenses liées | idem |
| `/facturation` | Liste des factures : filtres statut, client, période, **échues**, tri par échéance ; totaux | `invoice.manage` OU `accounting.view` |
| `/facturation/nouvelle` | Création brouillon multi-lignes, calcul temps réel côté client (**jamais la source de vérité**) | `invoice.manage` |
| `/facturation/[id]` | Détail + actions selon statut (Émettre / Annuler / Enregistrer un paiement / Créer un avoir) + historique + **lien vers l'écriture comptable** | `invoice.manage` OU `accounting.view` |
| `/facturation/[id]/modifier` | Édition **uniquement si `draft`** | `invoice.manage` |
| `/facturation/avoirs` + `/facturation/avoirs/[id]` | Avoirs | `invoice.manage` |
| `/facturation/paiements` | Encaissements, filtres période/client/compte | `payment.record` OU `accounting.view` |
| `/api/facturation/[id]/pdf` | **PDF de facture** — Route Handler rejouant la **même source de données** que l'écran (patron 2B/PAPEJ, jamais un second calcul) | `invoice.manage` |
| `/settings/taxes` | Configuration des taux de taxe | `invoice.manage` |

**Navigation** : deux entrées ajoutées à `lib/navigation.ts` — « Tiers »
et « Facturation », masquées si la permission est absente (patron 1C-UI).

**Exports** : CSV liste des factures, CSV relevé client, **PDF facture**
et **PDF relevé client** — tous via la même couche de données que
l'écran.

---

## §11 — Tests obligatoires

### 11.1 Unitaires
Calcul des lignes (quantité × prix, arrondi 2 décimales), agrégation des
taxes par taux, calcul d'échéance, calcul du solde, conversion HTG,
formatage PDF/CSV.

### 11.2 Intégration — comptabilité
- Émission → écriture **équilibrée**, bons comptes, bon journal (`SALES`), auxiliaire `customer`/`third_party_id` renseigné
- Facture **avec** et **sans** taxe ; **plusieurs taux** sur une même facture
- Encaissement → écriture + **`cash_movement`** créés et cohérents
- **Paiement partiel** → `partially_paid` ; **solde** → `paid`
- Avoir → écriture inverse, solde réduit
- Annulation facture non encaissée → **contre-passation** effective
- Annulation refusée si `amount_paid > 0`
- **Période fermée** → émission refusée
- **Réconciliation 2B** : une facture émise apparaît au **journal général**, au **grand livre** du compte client, à la **balance**, au **compte de résultat** ; un encaissement apparaît au **flux de trésorerie** — et **Actif = Passif + CP + Résultat reste vrai** après chaque événement

### 11.3 Intégration — sécurité
- **RLS/permissions** : `anon` (42501), authentifié sans permission (`not_authorized`), COMPTABLE (positif) sur **chaque** RPC
- **IDOR** : un `p_org_id`/`invoice_id`/`third_party_id` d'une autre organisation → refusé
- **Multi-organisation** : Org B ne voit ni ne modifie aucun document d'Org A
- **Immutabilité** : modification d'une facture émise refusée **même via `service_role`** ; suppression d'un tiers utilisé refusée
- **Séparation des fonctions** : un acteur ayant `invoice.manage` sans `payment.record` ne peut pas encaisser (et réciproquement)
- **`search_path`** : `debug_functions_with_mutable_search_path` = 0 sur les nouvelles fonctions (garde 2B déjà en place)

### 11.4 Intégration — multi-devise
Facture USD : montants USD conservés, contre-valeur HTG **historique**,
taux **non réévalué** après émission ; les états 2B restent en HTG.

### 11.5 E2E (Playwright)
Créer un tiers client → créer une facture brouillon → l'émettre →
vérifier l'écriture générée → encaisser partiellement → vérifier le
statut et le solde → **télécharger le PDF** → refus 403 pour un rôle
sans permission → invariant du bilan vérifié **automatiquement** après
le cycle.

---

## §12 — Risques de régression avec 1C / 2A / 2B

| Risque | Gravité | Mitigation |
|---|---|---|
| **`expense_requests` touché** (colonne ajoutée) | 🔴 Élevé | Colonne **nullable sans défaut**, `payee_name`/`payee_reference` intacts ; **aucune** RPC dépense modifiée ; rejeu intégral de `expenses.test.ts` et `expense-creator-visibility.test.ts` |
| **Comptes 1100/2100 devenus non supprimables** | 🟢 Faible | Déjà le cas via `chart_of_accounts_immutable_if_used` (2A) dès qu'ils portent une écriture |
| **États financiers 2B faussés** | 🔴 Élevé | Les factures alimentent les états **uniquement via des écritures postées** — exactement la source déjà exigée en 2B. Tests de réconciliation rejoués **après** chaque événement de facturation (§11.2) |
| **Flux de trésorerie 2B** | 🟡 Moyen | L'encaissement passe par un compte de trésorerie déjà identifié ; la classification dépend du `cash_flow_category` du compte client (**1100 = `operating`, déjà seedé**) |
| **`journal_entry_lines.third_party_id` sans FK** | 🟡 Moyen | Décision §16-D ; à défaut de FK, **trigger de validation** + tests |
| **Numérotation** | 🟡 Moyen | Réutilisation stricte de `next_number_internal` ; redéfinition de `seed_default_numbering_sequences()` en **conservant** les types existants + **backfill** — régression possible si un type est oublié → test dédié vérifiant les **7** types pour chaque organisation |
| **Performance Advisor** | 🟡 Moyen | Toute nouvelle FK est indexée (§3.2), toute policy utilise `(select auth.uid())` |
| **Security Advisor** | 🟡 Moyen | Les nouvelles RPC `SECURITY DEFINER` **ajouteront des warnings `authenticated_security_definer_function_executable`** (≈ 8-10) — **attendu et à auditer explicitement en clôture**, jamais supprimé mécaniquement. `search_path` fixé **dès l'écriture** sur **toutes** les fonctions, y compris les triggers (leçon `20260824090001`) |

---

## §13 — Migrations prévues, dans l'ordre

| # | Fichier | Contenu |
|---|---|---|
| **2C.1** | `..._third_parties.sql` | `third_parties`, `third_party_contacts`, contraintes, index, RLS, audit, trigger d'immutabilité si utilisé, numérotation `third_party` (+ backfill) |
| **2C.2** | `..._expense_requests_supplier_link.sql` | **Uniquement** `expense_requests.supplier_id` nullable + index partiel + trigger de cohérence (`is_supplier`) |
| **2C.3** | `..._tax_rates.sql` | `tax_rates` (aucun taux seedé), RLS, audit |
| **2C.4** | `..._customer_invoices.sql` | `customer_invoices`, `customer_invoice_lines`, contraintes, index, RLS, audit, triggers d'immutabilité, numérotation `customer_invoice` |
| **2C.5** | `..._multi_line_posting_helper.sql` | `app_private.create_and_post_multi_line_entry` (`create_and_post_two_line_entry` **inchangée**) |
| **2C.6** | `..._invoice_workflow_rpcs.sql` | `create/update/issue/cancel_customer_invoice` |
| **2C.7** | `..._credit_notes.sql` | `credit_notes`, `credit_note_lines`, RPC, numérotation `credit_note` |
| **2C.8** | `..._customer_payments.sql` | `customer_payments`, `customer_payment_allocations`, RPC, intégration `cash_movements`, numérotation `customer_payment` |
| **2C.9** | `..._customer_statement_report.sql` | `generate_customer_statement_report` (relevé / balance âgée) |

Chaque migration est **additive** et applicable indépendamment ; aucune
ne modifie une fonction ou une contrainte de 1C/2A/2B, à la seule
exception de `seed_default_numbering_sequences()` (redéfinie en
**cumulatif**, patron déjà utilisé trois fois).

---

## §14 — Explicitement EXCLU de Phase 2C

- ❌ **Rapprochement bancaire détaillé** → Phase 2D (le champ
  `cash_movements.reconciled` existe déjà, **non exploité** ici)
- ❌ **Immobilisations / amortissements** → Phase 2E
- ❌ **Prêt FDI** → Phase 2F
- ❌ **Dons & subventions supplémentaires** → Phase 2-bis
- ❌ **Refonte UX générale** → phase dédiée
- ❌ **Facturation fournisseur (AP) en documents distincts** → voir
  §16-A : le passif fournisseur transite **déjà** par
  `expense_requests`. Créer un second circuit risquerait un **double
  comptage** des charges — exclu par défaut
- ❌ **Devis / commandes / bons de livraison** — non demandés
- ❌ **Relances automatiques, écarts de change réalisés** (§16-E)
- ❌ **Écritures de clôture / affectation du résultat** — hors périmètre
- ❌ **Régularisation du verrou E2E 22/22 de Phase 2B** — dette
  distincte, sa propre fenêtre

---

## §15 — Hypothèses

1. **HTG est la devise fonctionnelle** ; les états consolidés restent en
   HTG (décision Phase 2B §8 reconduite). Devises autorisées : **HTG et
   USD** (aligné sur `contracts`).
2. Le **taux de change est saisi par transaction** et **figé** à
   l'émission — aucune table de taux, aucune réévaluation rétroactive.
   Cohérent avec l'absence de table `exchange_rates` constatée.
3. **Aucune fiscalité haïtienne n'est présumée.** `tax_rates` est livrée
   **vide** ; le format du NIF n'est **pas** contraint (pas de regex),
   faute de spécification validée.
4. Le **compte client par défaut est 1100** (déjà seedé), surchargeable
   par tiers.
5. Une facture porte **une seule devise** ; toutes ses lignes sont dans
   cette devise.
6. Le **paiement est dans la devise de la facture** (voir §16-E).
7. Les tiers sont **strictement cloisonnés par organisation** — pas de
   référentiel partagé inter-organisations.
8. Le numéro de facture est attribué **à l'émission**, pas au brouillon
   → aucun trou de séquence dû à des brouillons abandonnés.
9. La numérotation par défaut suit le patron existant :
   `FAC-{year}-{seq:04d}`, `AV-{year}-{seq:04d}`,
   `ENC-{year}-{seq:04d}`, `TRS-{seq:04d}` — **modifiables** par
   organisation (moteur déjà administrable).

---

## §16 — Décisions nécessitant votre arbitrage

**A. Périmètre fournisseur — recommandation forte**
Le passif fournisseur transite déjà par `expense_requests` → `expenses`
→ écriture (Phase 1C). **Recommandation : Phase 2C se limite, côté
fournisseur, à la fiche tiers + `expense_requests.supplier_id`**, sans
documents de facture fournisseur ni règlements fournisseurs distincts —
sinon **double comptage des charges** quasi certain. ▶ *Confirmez-vous
cette limitation ?*

**B. Séparation des fonctions sur la facture**
Trois niveaux possibles : (1) `invoice.manage` suffit pour créer **et**
émettre — *recommandé*, la SoD réelle étant déjà entre facturation et
encaissement ; (2) créateur ≠ émetteur imposé (façon écritures manuelles
2A) ; (3) workflow d'approbation complet avec table dédiée.
▶ *Quel niveau retenez-vous ?*

**C. Avoirs : tables séparées ou `document_type` ?**
(1) `credit_notes` + `credit_note_lines` **séparées** — *recommandé* :
règles d'immutabilité et numérotation distinctes, pas de convention de
signe piégeuse (rappel : le bug 2B venait d'une portée de calcul) ;
(2) une seule table avec `document_type in ('invoice','credit_note')` —
moins de code, mais invariants mêlés. ▶ *Votre choix ?*

**D. Clé étrangère sur `journal_entry_lines.third_party_id`**
La colonne est **polymorphe** (`customer`/`supplier` → `third_parties`,
`employee` → `employees`) : une FK unique est **impossible**.
Options : (1) **aucune FK physique + trigger de validation** —
*recommandé*, n'introduit aucun risque sur des lignes déjà
comptabilisées et immuables ; (2) FK partielle via table de liaison ;
(3) statu quo sans aucune validation. ▶ *Votre choix ?*

**E. Encaissement dans une devise différente de la facture**
Génère un **écart de change réalisé** nécessitant un compte dédié et des
règles validées. **Recommandation : interdire en 2C** (paiement dans la
devise de la facture) et traiter les écarts de change dans une phase
ultérieure. ▶ *Acceptez-vous cette restriction ?*

**F. Contacts et adresses**
Recommandation : **adresse principale en ligne** sur `third_parties` +
table `third_party_contacts` pour les contacts multiples. Alternative :
table `third_party_addresses` distincte (adresses de facturation et de
livraison multiples). ▶ *La version recommandée suffit-elle ?*

**G. Comptes de produits par défaut**
Faut-il un **compte de produit par défaut** configurable par tiers ou
par organisation, ou l'utilisateur choisit-il le compte **sur chaque
ligne** (recommandé, plus explicite) ? ▶ *Votre préférence ?*

---

## §17 — Séquence de livraison proposée

Chaque sous-jalon se termine par : migrations appliquées, tests verts,
typecheck/lint/build, scan secrets, `git status` propre, **arrêt pour
votre validation** avant le suivant.

| Jalon | Contenu | Valeur livrée |
|---|---|---|
| **2C.1** | Référentiel de tiers + contacts + écrans `/tiers` + lien `expense_requests.supplier_id` | Référentiel exploitable immédiatement, **sans aucun impact comptable** — donc risque de régression minimal |
| **2C.2** | Taxes configurables + factures brouillon (tables, RLS, écrans, aucune écriture) | Saisie possible, toujours **aucun impact comptable** |
| **2C.3** | Helper multi-lignes + **émission** + annulation + écritures + tests de réconciliation 2B | **Premier impact comptable** — jalon le plus sensible, isolé volontairement |
| **2C.4** | Encaissements + allocations + intégration trésorerie/`cash_movements` | Cycle client complet |
| **2C.5** | Avoirs | Correction sans destruction |
| **2C.6** | PDF facture + relevé client + exports + E2E | Finalisation |

Cet ordre place **tout le risque comptable en 2C.3**, après deux jalons
sans écriture — donc facilement réversible si un problème apparaît.

---

## §18 — Critères de clôture de Phase 2C

1. Les **9 migrations** appliquées, **strictement additives**, aucune
   contrainte 1C/2A/2B affaiblie.
2. **Tests de réconciliation comptable verts** : après émission,
   encaissement, avoir et annulation, journal général / grand livre /
   balance / résultat / bilan restent **mutuellement réconciliables**, et
   **Actif = Passif + CP + Résultat** reste vrai — vérifié
   **automatiquement**, jamais visuellement.
3. **Sécurité** : matrice complète (anon / sans permission / autre
   organisation / positif) sur **chaque** RPC ; immutabilité prouvée
   **y compris via `service_role`** ; `debug_functions_with_mutable_search_path` = **0**.
4. **Non-régression** : suites 1C/2A/2B rejouées, en particulier
   `expenses.test.ts` (colonne ajoutée) et
   `financial-statements-reconciliation.test.ts`.
5. **E2E** du cycle complet.
6. **typecheck / lint / build** propres ; **scan secrets** ; `git status`
   propre.
7. **Security Advisor rejoué par vous**, avec décompte **par catégorie**
   (corrigé / audité-accepté / limitation plateforme) — les nouvelles
   RPC `SECURITY DEFINER` seront **auditées explicitement**, jamais
   supprimées mécaniquement. **Aucune prétention à « 0 warning ».**
8. **Performance Advisor** rejoué : aucune FK non indexée, aucune
   régression `auth_rls_initplan`.
9. **Rapport de clôture** distinguant, comme en 2B : dernière passe
   continue, échecs d'infrastructure éventuels, tests spécifiques 2C,
   rejeux ciblés — **jamais un total reconstitué présenté comme une
   passe unique**.

---

**Je m'arrête ici. Aucune migration, aucun code applicatif, aucun commit
d'implémentation Phase 2C ne sera produit avant votre validation de ce
plan et vos arbitrages §16.**
