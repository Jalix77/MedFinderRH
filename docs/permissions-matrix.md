# MedFinder Gestion — Matrice Rôles / Permissions

Statut : Phase 0 — Proposition en attente de validation.
Toutes les permissions listées ici sont vérifiées côté serveur (Server Actions /
Route Handlers) **et** répliquées en RLS via `has_permission()` — voir `security.md`.

## 1. Rôles (catalogue Phase 1)

| Code | Libellé | Portée |
|---|---|---|
| `SUPER_ADMIN` | Super administrateur | Technique global, toutes organisations |
| `DIRECTEUR_GENERAL` | Directeur Général | Direction, finance, RH, validations, rapports |
| `DIRECTEUR_TECHNIQUE` | Directeur Technique | Produit, technique, utilisateurs techniques, logs |
| `COMPTABLE` | Comptable | Comptabilité, finance, banques, caisse, rapprochement |
| `RH` | Ressources Humaines | Employés, contrats, congés, recrutement, payroll (selon permission) |
| `MANAGER` | Manager d'équipe | Équipe directe, approbations définies |
| `AGENT_TERRAIN` | Agent terrain | Ses prospects, visites, tâches, objectifs, dépenses autorisées |
| `SUPPORT` | Support | Support, prestataires, tickets, modération |
| `EMPLOYE` | Employé | Accès personnel limité |

## 2. Catalogue de permissions (par module)

### RH
`employee.create`, `employee.update`, `employee.view`, `employee.view_salary`,
`employee.terminate`, `contract.manage`, `leave.request`, `leave.approve`,
`attendance.manage`, `recruitment.manage`

### Dépenses & achats
`expense.create`, `expense.approve`, `expense.pay`, `expense.cancel`,
`expense.view`, `supplier.manage`

### Budget
`budget.manage`, `budget.view`, `budget.transfer`

### Comptabilité & trésorerie
`accounting.post`, `accounting.reverse`, `accounting.close_period`,
`accounting.view`, `treasury.manage`, `treasury.reconcile`

### PAPEJ
`papej.view`, `papej.manage`, `papej.report`

### Dons & subventions
`donation.view`, `donation.create`, `donation.update`, `donation.approve`,
`donation.allocate`, `donation.close`, `donation.report`, `grant.view`,
`grant.manage`, `restricted_fund.manage`

### Prêt FDI
`loan.manage`, `loan.view`

### Ventes / facturation
`invoice.manage`, `payment.record`, `subscription.manage`, `customer.manage`

### Immobilisations
`asset.manage`, `asset.view`

### Payroll
`payroll.prepare`, `payroll.approve`, `payroll.pay`, `payroll.view_all`,
`payroll.view_own`, `advance.request`, `advance.approve`

### CRM terrain
`crm.manage`, `crm.view_own`, `crm.view_all`, `commission.manage`

### Documents
`document.upload`, `document.view_confidential`

### Administration & audit
`audit.view`, `user.manage`, `role.manage`, `permission.override`,
`settings.manage`

## 3. Matrice complète (● = accordé par défaut au rôle, ○ = non accordé par défaut, accessible via override individuel tracé)

Les 64 permissions du catalogue, une ligne par permission — exhaustif (mis à
jour lors de l'audit pré-Phase 1B pour couvrir les ~29 lignes initialement
absentes du résumé ; vérifié par export direct des 211 associations
`role_permissions` réellement seedées, voir
`docs/phase-1a-closing-report.md` §Audit point 4 — aucun écart trouvé entre
cette table et la base).

| Permission | SUPER_ADMIN | DG | DT | COMPTABLE | RH | MANAGER | AGENT_TERRAIN | SUPPORT | EMPLOYE |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| employee.create | ● | ● | ○ | ○ | ● | ○ | ○ | ○ | ○ |
| employee.update | ● | ● | ○ | ○ | ● | ○ | ○ | ○ | ○ |
| employee.view | ● | ● | ○ | ○ | ● | ○ | ○ | ○ | ○ |
| employee.view_salary | ● | ○ | ○ | ● | ○* | ○ | ○ | ○ | ○ |
| employee.terminate | ● | ● | ○ | ○ | ● | ○ | ○ | ○ | ○ |
| contract.manage | ● | ● | ○ | ○ | ● | ○ | ○ | ○ | ○ |
| leave.request | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| leave.approve | ● | ● | ○ | ○ | ● | ●(équipe) | ○ | ○ | ○ |
| attendance.manage | ● | ● | ○ | ○ | ● | ○ | ○ | ○ | ○ |
| recruitment.manage | ● | ● | ○ | ○ | ● | ○ | ○ | ○ | ○ |
| expense.create | ● | ● | ● | ● | ● | ● | ●(propres) | ○ | ○ |
| expense.approve | ● | ● | ○ | ○ | ○ | ●(équipe) | ○ | ○ | ○ |
| expense.pay | ● | ○ | ○ | ● | ○ | ○ | ○ | ○ | ○ |
| expense.cancel | ● | ● | ○ | ● | ○ | ○ | ○ | ○ | ○ |
| expense.view | ● | ● | ● | ● | ● | ● | ○ | ○ | ○ |
| supplier.manage | ● | ○ | ○ | ● | ○ | ○ | ○ | ○ | ○ |
| budget.manage | ● | ● | ○ | ● | ○ | ○ | ○ | ○ | ○ |
| budget.view | ● | ● | ○ | ● | ○ | ● | ○ | ○ | ○ |
| budget.transfer | ● | ● | ○ | ● | ○ | ○ | ○ | ○ | ○ |
| accounting.post | ● | ○ | ○ | ● | ○ | ○ | ○ | ○ | ○ |
| accounting.reverse | ● | ○ | ○ | ● | ○ | ○ | ○ | ○ | ○ |
| accounting.close_period | ● | ●(validation) | ○ | ●(préparation) | ○ | ○ | ○ | ○ | ○ |
| accounting.view | ● | ● | ○ | ● | ○ | ○ | ○ | ○ | ○ |
| treasury.manage | ● | ○ | ○ | ● | ○ | ○ | ○ | ○ | ○ |
| treasury.reconcile | ● | ○ | ○ | ● | ○ | ○ | ○ | ○ | ○ |
| papej.view | ● | ● | ○ | ● | ○ | ○ | ○ | ○ | ○ |
| papej.manage | ● | ● | ○ | ● | ○ | ○ | ○ | ○ | ○ |
| papej.report | ● | ● | ○ | ● | ○ | ○ | ○ | ○ | ○ |
| donation.view | ● | ● | ○ | ● | ○ | ○ | ○ | ○ | ○ |
| donation.create | ● | ● | ○ | ● | ○ | ○ | ○ | ○ | ○ |
| donation.update | ● | ● | ○ | ● | ○ | ○ | ○ | ○ | ○ |
| donation.approve | ● | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| donation.allocate | ● | ● | ○ | ● | ○ | ○ | ○ | ○ | ○ |
| donation.close | ● | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| donation.report | ● | ● | ○ | ● | ○ | ○ | ○ | ○ | ○ |
| grant.view | ● | ● | ○ | ● | ○ | ○ | ○ | ○ | ○ |
| grant.manage | ● | ● | ○ | ● | ○ | ○ | ○ | ○ | ○ |
| restricted_fund.manage | ● | ● | ○ | ● | ○ | ○ | ○ | ○ | ○ |
| loan.manage | ● | ● | ○ | ● | ○ | ○ | ○ | ○ | ○ |
| loan.view | ● | ● | ○ | ● | ○ | ○ | ○ | ○ | ○ |
| invoice.manage | ● | ○ | ○ | ● | ○ | ○ | ○ | ○ | ○ |
| payment.record | ● | ○ | ○ | ● | ○ | ○ | ○ | ○ | ○ |
| subscription.manage | ● | ● | ○ | ○ | ○ | ○ | ●(propres) | ○ | ○ |
| customer.manage | ● | ● | ○ | ● | ○ | ○ | ○ | ○ | ○ |
| asset.manage | ● | ● | ● | ○ | ○ | ○ | ○ | ○ | ○ |
| asset.view | ● | ● | ● | ● | ○ | ○ | ○ | ○ | ○ |
| payroll.prepare | ● | ○ | ○ | ○ | ● | ○ | ○ | ○ | ○ |
| payroll.approve | ● | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| payroll.pay | ● | ○ | ○ | ● | ○ | ○ | ○ | ○ | ○ |
| payroll.view_all | ● | ○ | ○ | ● | ●(agrégé) | ○ | ○ | ○ | ○ |
| payroll.view_own | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| advance.request | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| advance.approve | ● | ● | ○ | ○ | ● | ○ | ○ | ○ | ○ |
| crm.manage | ● | ● | ○ | ○ | ○ | ●(équipe) | ○ | ○ | ○ |
| crm.view_own | ● | ● | ○ | ○ | ○ | ● | ● | ○ | ○ |
| crm.view_all | ● | ● | ○ | ○ | ○ | ● | ○ | ○ | ○ |
| commission.manage | ● | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| document.upload | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| document.view_confidential | ● | ● | ○ | ●(finance) | ●(RH) | ○ | ○ | ○ | ○ |
| audit.view | ● | ● | ●(technique) | ○ | ○ | ○ | ○ | ○ | ○ |
| user.manage | ● | ● | ●(comptes techniques) | ○ | ○ | ○ | ○ | ○ | ○ |
| role.manage | ● | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| permission.override | ● | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| settings.manage | ● | ● | ●(technique) | ○ | ○ | ○ | ○ | ○ | ○ |

`*` RH voit les données salariales agrégées nécessaires au traitement de la paie
si `payroll.prepare` est accordé, mais pas `employee.view_salary` individuel sans
octroi explicite — distinction volontaire entre « traiter la paie » et « consulter
un salaire isolément ».

## 4. Règles transverses

- **Auto-approbation interdite** : un `approver_id` ne peut jamais être égal au
  `requester_id` d'origine (dépenses, congés, dons) — appliqué en RLS, pas
  seulement en UI.
- **Élévation de privilège** : seul `role.manage` (SUPER_ADMIN et
  DIRECTEUR_GENERAL) permet de modifier les rôles assignés à un membership ;
  `DIRECTEUR_TECHNIQUE` dispose de `user.manage` pour les comptes techniques
  uniquement (créer/suspendre), pas de `role.manage`. Toute modification est
  auditée.
- **Overrides individuels** (`user_permission_overrides`) : toujours accompagnés
  d'une raison, d'un auteur, et visibles dans `audit.view` — jamais un octroi
  silencieux.
- **Visibilité de menu ≠ autorisation** : la sidebar n'affiche que les modules
  autorisés (§53), mais l'accès réel est revérifié à chaque action serveur,
  jamais déduit du seul affichage.

## 5. Décision ouverte

Le tableau ci-dessus est une proposition de référence Phase 1. Les cases `MANAGER`
« équipe » supposent une notion de hiérarchie (`employees.manager_employee_id`)
comme périmètre d'approbation — à confirmer avec Jean Alix Pierre avant
implémentation (voir `docs/roadmap.md` §Décisions, D3).
