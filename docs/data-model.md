# MedFinder Gestion — Modèle de données complet

Extension documentaire justifiée en `architecture.md` ADR-002 : le modèle dépasse
55 tables, isolé ici pour lisibilité. Ce fichier fait foi pour les migrations SQL.

## Conventions globales

- Clé primaire : `id uuid primary key default gen_random_uuid()`.
- Toute table métier : `organization_id uuid not null references organizations(id)`.
- Horodatage : `created_at timestamptz not null default now()`, `updated_at timestamptz
  not null default now()` (trigger de mise à jour), `created_by uuid references
  users(id)`, `updated_by uuid references users(id)`.
- Soft delete sur objets métier non financiers : `deleted_at timestamptz`. Sur
  objets financiers : jamais de delete, uniquement `status` (`draft`, `posted`,
  `cancelled`, `reversed`, `closed`).
- Montants : `numeric(14,2)` jamais `float`. Devise : `currency char(3)` (`HTG`/`USD`).
  Contrainte `CHECK (amount >= 0)` où pertinent (montants négatifs uniquement via
  signe débit/crédit explicite dans les écritures).
- Toute FK vers un objet « statut » utilise une contrainte `CHECK` ou une table de
  référence, jamais une chaîne libre non contrainte.
- Suffixe `_id` uniquement pour les FK ; tables de jonction nommées `a_b`.

## A. Identité, accès, organisation

- **organizations** — id, name, legal_name, tax_id, default_currency, fiscal_year_start_month, timezone, status.
- **users** — miroir minimal de `auth.users` (id identique), full_name, phone, avatar_url, mfa_enabled, status. Aucune donnée d'authentification dupliquée (gérée par Supabase Auth).
- **memberships** — user_id, organization_id, role_id, status (`active`/`suspended`), UNIQUE(user_id, organization_id).
- **roles** — organization_id (nullable pour rôles système globaux), code (`SUPER_ADMIN`, `DIRECTEUR_GENERAL`, …), label, is_system.
- **permissions** — code (`employee.view_salary`, `expense.approve`, …), module, description. Catalogue global, non lié à une organisation.
- **role_permissions** — role_id, permission_id, UNIQUE(role_id, permission_id).
- **user_permission_overrides** — user_id, organization_id, permission_id, effect (`grant`/`revoke`), reason, granted_by, expires_at. Permet une exception individuelle traçable sans créer un rôle ad hoc.
- **approval_thresholds** — organization_id, scope (`expense`, `payroll`, `budget_transfer`), min_amount, max_amount, required_role_id / required_permission_code. Rend les seuils d'approbation configurables (§79).

## B. Structure RH

- **departments** — organization_id, name, parent_department_id (hiérarchie), status.
- **positions** — organization_id, department_id, title, description, responsibilities (text), required_skills (text), reports_to_position_id, status.
- **employees** — organization_id, user_id (nullable si pas encore de compte), matricule (unique/org), first_name, last_name, gender, birth_date, phone, personal_email, address, nif, ninu, cin, emergency_contact (jsonb), hire_date, status (`active`,`on_leave`,`terminated`), department_id, position_id, manager_employee_id, contract_type, payment_method, bank_account_masked, moncash_number, photo_url, hr_notes (accès restreint), sensitivity_tier (`confidential`/`very_sensitive` par champ — voir security.md).
- **employee_documents** — employee_id, type, storage_path, visibility, uploaded_by, version.
- **contracts** — employee_id, type (`CDI`,`CDD`,`consultant`,`prestataire`,`temps_partiel`,`fondateur`,`stage`), start_date, end_date, probation_end_date, base_salary, currency, benefits (jsonb), document_storage_path, status, renewal_of_contract_id.
- **contract_amendments** — contract_id, effective_date, change_description, document_storage_path.
- **leave_types** — organization_id, name, paid (bool), annual_quota_days.
- **leave_requests** — employee_id, leave_type_id, start_date, end_date, days_count, reason, status (`pending`,`manager_approved`,`hr_approved`,`rejected`,`cancelled`), approver_id, supporting_document_path.
- **leave_balances** — employee_id, leave_type_id, year, accrued_days, used_days.
- **attendance** — employee_id, work_date, check_in, check_out, status (`present`,`late`,`absent`,`justified`), overtime_minutes, source (`manual`,`digital`).
- **timesheets** — employee_id, period_start, period_end, total_hours, overtime_hours, status.

## C. Recrutement

- **recruitment_jobs** — organization_id, title, department_id, description, status (`open`,`paused`,`closed`), open_date, budget.
- **candidates** — job_id, full_name, phone, email, cv_storage_path, source, score, status (`applied`,`screening`,`test`,`interview`,`reference_check`,`offer`,`hired`,`rejected`).
- **candidate_events** — candidate_id, event_type, event_date, notes, created_by.
- **scoring_grids** / **candidate_scores** — grille de notation configurable par poste, scores par critère.

## D. Trésorerie

- **cash_accounts** (caisses) — organization_id, name (`principale`,`petite_caisse`,…), currency, current_balance (dérivé, recalculé par trigger/vue), status.
- **bank_accounts** — organization_id, bank_name, account_number_masked, currency, current_balance, status.
- **mobile_money_accounts** — organization_id, provider (`MonCash`,`NatCash`,…), account_number_masked, currency, current_balance.
- **cash_movements** — cash_account_id (ou bank_account_id ou mobile_money_account_id — modélisé via `treasury_account_type` + `treasury_account_id` polymorphe contrôlé par CHECK), direction (`in`/`out`), amount, currency, exchange_rate_to_htg, movement_date, reference_type (`expense`,`invoice_payment`,`payroll`,`donation`,`manual`), reference_id, description, reconciled (bool), journal_entry_id.
- **bank_reconciliations** — bank_account_id, period_start, period_end, imported_statement_ref, status (`in_progress`,`closed`), closed_by, closed_at.
- **bank_reconciliation_lines** — reconciliation_id, cash_movement_id, statement_line_ref, matched (bool), difference_amount.

## E. Budget

- **fiscal_years** — organization_id, label, start_date, end_date, status (`open`,`closed`).
- **budgets** — organization_id, fiscal_year_id, name, version, status (`draft`,`approved`,`revised`), source_type (`general`,`papej`,`grant`,`donation` — voir F/G), source_id (nullable).
- **budget_lines** — budget_id, cost_center_id, category, planned_amount, currency.
- **cost_centers** — organization_id, code, name, department_id (nullable).
- **budget_commitments** (engagements) — budget_line_id, reference_type (`expense_request`,`purchase_order`), reference_id, amount, status (`active`,`released`,`consumed`).
- **budget_transfers** — organization_id, budget_id, from_line_id, to_line_id, amount, reason, approved_by, approved_at.

Vue calculée `budget_line_balances` : `disponible = planned_amount − sum(engagements actifs) − sum(paiements non engagés)`.

## F. PAPEJ (financement)

- **grants** — organization_id, type fixe `PAPEJ` (extensible), name, donor_name, amount_granted (850 000 HTG au départ, modifiable via avenant tracé), currency, received_date, status (`active`,`closed`), agreement_document_path.
- **grant_budget_lines** — grant_id, category (configurable, pas hardcodé), planned_amount, engaged_amount (dérivé), paid_amount (dérivé), notes.
- **grant_expenses** — table de liaison expense_id ↔ grant_budget_line_id (une dépense peut être partiellement rattachée à plusieurs lignes si nécessaire — `allocated_amount`).
- **grant_reports** — grant_id, period_start, period_end, generated_by, storage_path, status.

## G. Dons, subventions & contributions (hors PAPEJ/FDI/apports commerciaux)

- **contribution_types** — organization_id, code, label (configurable : don non affecté, don affecté, don en nature, subvention, contribution institutionnelle, partenaire, sponsoring, exceptionnelle, apport fondateur).
- **contributions** — organization_id, reference_number, contribution_type_id, donor_name, donor_contact_name, donor_address, donor_phone, donor_email, received_date, amount, currency, receipt_method (`bank`,`cash`,`mobile_money`,`in_kind`), treasury_account_type/id, purpose, program_or_project, is_restricted (bool), restriction_terms, usage_period_start, usage_period_end, supporting_document_path, agreement_document_path, status (`pledged`,`validated`,`received`,`allocated`,`closed`).
- **contribution_budget_lines** — contribution_id, category, planned_amount, engaged_amount (dérivé), paid_amount (dérivé).
- **contribution_expenses** — expense_id ↔ contribution_budget_line_id, allocated_amount.
- **in_kind_contributions** — contribution_id, description, quantity, estimated_value, currency, valuation_method, beneficiary, created_asset_id (nullable FK vers `assets`, création assistée §immobilisations).
- **contribution_documents** — contribution_id, type (`accusé_réception`,`reçu`,`lettre_remerciement`,`attestation`), storage_path, generated_at. Aucun document n'est libellé "reçu fiscal déductible" sans validation juridique (flag `tax_deductible_confirmed boolean default false`).
- **accounting_treatment_rules** — organization_id, contribution_type_id, debit_account_id, credit_account_id, treatment (`revenue`,`restricted_fund`,`contribution_capital`,`asset`,`deferred`). Configurable par le comptable (§29).

## H. Prêt FDI

- **loans** — organization_id, lender_name, contract_number, principal_amount, currency, disbursement_date, term_months, grace_period_months, interest_rate_annual, amortization_method (`constant_installment`,`constant_principal`), status (`draft`,`active`,`closed`). Paramètres non figés tant que le contrat définitif n'est pas signé (`is_provisional boolean`).
- **loan_schedules** — loan_id, installment_number, due_date, principal_due, interest_due, total_due, remaining_principal, status (`pending`,`paid`,`late`). Générée automatiquement à la saisie des conditions contractuelles réelles (trigger/fonction).
- **loan_payments** — schedule_id, paid_date, amount, treasury_account_type/id, journal_entry_id.

## I. Comptabilité

- **chart_of_accounts** — organization_id, code, label, type (`asset`,`liability`,`equity`,`revenue`,`expense`), parent_account_id, is_active.
- **accounting_periods** — organization_id, fiscal_year_id, month, status (`open`,`closed`), closed_by, closed_at.
- **journals** — organization_id, code (`BANK`,`CASH`,`SALES`,`PURCHASES`,`PAYROLL`,`MISC`), label.
- **journal_entries** — organization_id, journal_id, period_id, entry_number (JE-2026-0001), entry_date, description, source_type (`expense`,`invoice`,`payroll`,`asset`,`loan`,`contribution`,`manual`), source_id, status (`draft`,`posted`,`reversed`), reversed_entry_id (self-FK), posted_by, posted_at.
- **journal_entry_lines** — entry_id, account_id, debit numeric(14,2) default 0, credit numeric(14,2) default 0, third_party_type (`customer`/`supplier`/`employee`/null), third_party_id, cost_center_id, currency, exchange_rate_to_htg. `CHECK (debit = 0 OR credit = 0)` (une ligne n'est jamais débit ET crédit) ; trigger niveau `journal_entries` garantissant `SUM(debit) = SUM(credit)` avant passage à `posted`.

## J. Tiers, ventes, facturation

- **customers** — organization_id, type (`prestataire_pro`,`partenaire`,`sponsor`,`institution`), name, tax_id, contact, address, currency, status.
- **suppliers** — organization_id, type (`entreprise`,`consultant`,`vendeur_equipement`,`fournisseur_cloud`), name, tax_id, contact, address, currency, status.
- **invoices** — organization_id, customer_id, invoice_number (MFH-INV-2026-0001), issue_date, due_date, currency, status (`draft`,`sent`,`partially_paid`,`paid`,`cancelled`), journal_entry_id.
- **invoice_lines** — invoice_id, description, quantity, unit_price, subscription_id (nullable).
- **credit_notes** (avoirs) — invoice_id, amount, reason, journal_entry_id.
- **payments** — organization_id, direction (`in`/`out`), party_type (`customer`/`supplier`), party_id, invoice_id (nullable), payment_number (PAY-2026-0001), amount, currency, method, treasury_account_type/id, journal_entry_id.
- **subscriptions** — organization_id, customer_id, plan (`Standard`,`Pro`,`Sponsoring`,`Publicité`,`Campagne`), start_date, end_date, price, currency, frequency, status, payment_history (via `payments` liés).

## K. Immobilisations

- **assets** — organization_id, asset_code (AST-0001), description, category, acquisition_value, currency, acquisition_date, supplier_id, assigned_employee_id, location, condition, warranty_end_date, useful_life_months, depreciation_method, purchase_document_path, journal_entry_id (écriture d'acquisition).
- **asset_assignments** — asset_id, employee_id, assigned_at, returned_at, condition_notes.
- **asset_depreciation_schedules** — asset_id, period_id, amount, accumulated_depreciation, journal_entry_id.

## L. Dépenses

- **expense_categories** — organization_id, name, default_account_id.
- **expense_requests** — organization_id, expense_number (DEP-2026-0001), requester_id, category_id, cost_center_id, budget_line_id, supplier_id, description, amount, currency, requested_date, payment_method, status (`draft`,`submitted`,`approved`,`rejected`,`committed`,`paid`,`justified`,`posted`,`reconciled`,`cancelled`).
- **expense_approvals** — expense_id, approver_id, decision (`approved`,`rejected`), decided_at, comment, is_exception (bool, si séparation des fonctions contournée), exception_reason, dg_validated_by (si exception).
- **expenses** (paiement effectif) — expense_request_id, paid_by, paid_date, treasury_account_type/id, journal_entry_id.
- **expense_attachments** — expense_request_id, type (`facture`,`reçu`,`justificatif`), storage_path, uploaded_by.

## M. Payroll

- **salary_components** — organization_id, code, label, type (`earning`,`deduction`), taxable (bool), calculation_rule (jsonb — moteur configurable, pas de taux hardcodé).
- **payroll_runs** — organization_id, period_start, period_end, status (`preparing`,`calculated`,`reviewed`,`dg_approved`,`paid`,`posted`,`locked`), approved_by, locked_at.
- **payroll_items** — payroll_run_id, employee_id, gross_amount, net_amount, currency, status.
- **payroll_item_lines** — payroll_item_id, salary_component_id, amount.
- **payslips** — payroll_item_id, storage_path (PDF), generated_at.
- **employee_advances** — employee_id, requested_amount, approved_amount, request_date, status (`requested`,`approved`,`rejected`,`disbursed`,`repaying`,`settled`), repayment_schedule (jsonb), linked_payroll_item_ids (déductions).

## N. CRM terrain

- **crm_prospects** — organization_id, reference (CRM-0001), establishment_name, type (pharmacie/médecin/labo/clinique/hôpital/centre de santé), commune, address, gps_lat, gps_lng, contact_name, phone, whatsapp, assigned_agent_id, status (`identifie`,`a_visiter`,`visite`,`interesse`,`onboarding`,`standard`,`pro`,`inactif`), notes.
- **crm_visits** — prospect_id, agent_id, visit_date, result, met_person, demo_done (bool), signed_up (bool), attachments (via `documents`), next_action, notes, gps_lat, gps_lng (capture optionnelle, jamais de tracking permanent — voir security.md).
- **crm_tasks** — organization_id, assigned_agent_id, related_prospect_id, title, due_date, status.
- **agent_objectives** — agent_id, period, target_visits, target_onboardings, target_pro_conversions, target_revenue.
- **commission_rules** — organization_id, type (`objective_bonus`,`conversion_commission`,`collected_payment_commission`), calculation_rule (jsonb), condition (`payment_collected_only` — jamais de commission sur abonnement non encaissé, contrainte applicative + vérification à la génération).
- **commission_entries** — agent_id, rule_id, source_type (`subscription`,`payment`), source_id, amount, status (`pending`,`validated`,`paid`).

## O. Documents, notifications, audit

- **documents** — organization_id, owner_type, owner_id, type, storage_path (bucket privé), visibility, version, uploaded_by, checksum.
- **notifications** — organization_id, user_id, type, title, body, related_type, related_id, read_at, created_at.
- **numbering_sequences** — organization_id, entity_type (`employee`,`expense`,`invoice`,`payment`,`journal_entry`,`asset`,`crm_prospect`), prefix_pattern, current_value, reset_rule (`yearly`/`never`).
- **audit_logs** — organization_id, user_id, action, module, object_type, object_id, old_value (jsonb), new_value (jsonb), occurred_at, ip_address, user_agent, result (`success`,`denied`,`error`). Append-only : aucun rôle applicatif ne dispose de UPDATE/DELETE (voir security.md).

## Justification des ajouts par rapport à la liste minimale du prompt maître (§54)

| Ajout | Raison |
|---|---|
| `role_permissions` + `user_permission_overrides` distincts | Le prompt demande RBAC + permissions granulaires ; séparer le défaut par rôle des exceptions individuelles traçables (§80, exceptions séparation des fonctions) sans complexifier `roles`. |
| `approval_thresholds` | Rend les seuils d'approbation réellement configurables (§79) plutôt qu'en dur dans le code. |
| `contribution_*` (module G complet) | Le prompt maître exige un module Dons/Subventions distinct et détaillé — non présent dans la liste minimale §54, mais explicitement requis ailleurs dans le prompt. |
| `accounting_treatment_rules` | Le comptable doit pouvoir définir le traitement comptable par type de contribution sans redéploiement (§29 du module dons). |
| `numbering_sequences` | Numérotation automatique configurable exigée §78, absente de la liste minimale. |
| `loan_schedules` séparé de `loans` | Tableau d'amortissement généré automatiquement (§28), nécessite sa propre table temporelle. |
| `expense_approvals` séparé de `expense_requests` | Traçabilité de chaque décision (y compris rejets et exceptions de séparation des fonctions) plutôt qu'un seul champ statut. |
| `in_kind_contributions` | Dons en nature avec valorisation et création d'actif assistée (§6 module dons). |

## Intégrité (rappel, détaillé dans architecture.md et security.md)

- FK sur toute relation, `ON DELETE RESTRICT` par défaut pour les objets financiers
  (jamais de cascade qui supprimerait silencieusement une transaction).
- `CHECK` : montants ≥ 0 (sauf lignes d'écriture où le signe est porté par
  débit/crédit distincts), dates cohérentes (`end_date >= start_date`), devises
  dans `('HTG','USD')`.
- Triggers Postgres pour : équilibre des écritures, verrouillage période/paie
  fermée, immutabilité `audit_logs`, mise à jour `updated_at`.
