-- MedFinder Gestion — Phase 1A
-- Donnees de reference (pas des donnees de demo) : catalogue des 9 roles
-- systeme, catalogue de permissions granulaires, et matrice role_permissions
-- par defaut — voir docs/permissions-matrix.md (version corrigee : voir
-- note sur user.manage/role.manage dans le rapport de cloture Phase 1A).
-- Ce fichier est charge dans TOUS les environnements (dev/staging/prod) via
-- les migrations, contrairement a supabase/seed.sql qui est DEV uniquement.

-- --- Roles systeme -----------------------------------------------------
insert into public.roles (organization_id, code, label, is_system) values
  (null, 'SUPER_ADMIN',        'Super administrateur',    true),
  (null, 'DIRECTEUR_GENERAL',  'Directeur General',       true),
  (null, 'DIRECTEUR_TECHNIQUE','Directeur Technique',     true),
  (null, 'COMPTABLE',          'Comptable',               true),
  (null, 'RH',                 'Ressources Humaines',     true),
  (null, 'MANAGER',            'Manager',                 true),
  (null, 'AGENT_TERRAIN',      'Agent terrain',           true),
  (null, 'SUPPORT',            'Support',                 true),
  (null, 'EMPLOYE',            'Employe',                 true);

-- --- Catalogue de permissions --------------------------------------------
insert into public.permissions (code, module, description) values
  ('employee.create',            'rh',           'Creer une fiche employe'),
  ('employee.update',            'rh',           'Modifier une fiche employe'),
  ('employee.view',              'rh',           'Consulter l''annuaire employes (hors donnees tres sensibles)'),
  ('employee.view_salary',       'rh',           'Consulter la remuneration individuelle d''un employe'),
  ('employee.terminate',         'rh',           'Mettre fin au contrat d''un employe'),
  ('contract.manage',            'rh',           'Gerer les contrats de travail'),
  ('leave.request',              'rh',           'Demander un conge pour soi-meme'),
  ('leave.approve',              'rh',           'Approuver une demande de conge'),
  ('attendance.manage',          'rh',           'Gerer la presence et les feuilles de temps'),
  ('recruitment.manage',         'rh',           'Gerer le pipeline de recrutement'),
  ('expense.create',             'finance',      'Creer une demande de depense'),
  ('expense.approve',            'finance',      'Approuver une demande de depense'),
  ('expense.pay',                'finance',      'Enregistrer le paiement d''une depense'),
  ('expense.cancel',             'finance',      'Annuler une depense'),
  ('expense.view',               'finance',      'Consulter les depenses'),
  ('supplier.manage',            'finance',      'Gerer les fiches fournisseurs'),
  ('budget.manage',              'finance',      'Creer/modifier un budget ou ses lignes'),
  ('budget.view',                'finance',      'Consulter les budgets'),
  ('budget.transfer',            'finance',      'Transferer des montants entre lignes budgetaires'),
  ('accounting.post',            'comptabilite', 'Comptabiliser une ecriture'),
  ('accounting.reverse',         'comptabilite', 'Contre-passer une ecriture'),
  ('accounting.close_period',    'comptabilite', 'Cloturer une periode comptable'),
  ('accounting.view',            'comptabilite', 'Consulter les etats comptables'),
  ('treasury.manage',            'tresorerie',   'Gerer caisses, comptes bancaires et mobile money'),
  ('treasury.reconcile',         'tresorerie',   'Effectuer un rapprochement bancaire'),
  ('papej.view',                 'papej',        'Consulter le financement PAPEJ'),
  ('papej.manage',               'papej',        'Gerer les lignes budgetaires PAPEJ'),
  ('papej.report',               'papej',        'Generer un rapport PAPEJ'),
  ('donation.view',              'dons',         'Consulter les dons et subventions'),
  ('donation.create',            'dons',         'Enregistrer un don ou une subvention'),
  ('donation.update',            'dons',         'Modifier un don ou une subvention'),
  ('donation.approve',           'dons',         'Approuver une utilisation hors affectation declaree'),
  ('donation.allocate',          'dons',         'Affecter un don a un budget/projet'),
  ('donation.close',             'dons',         'Cloturer un don ou une subvention'),
  ('donation.report',            'dons',         'Generer un rapport bailleur'),
  ('grant.view',                 'dons',         'Consulter les subventions institutionnelles'),
  ('grant.manage',               'dons',         'Gerer les subventions institutionnelles'),
  ('restricted_fund.manage',     'dons',         'Gerer les fonds affectes'),
  ('loan.manage',                'fdi',          'Gerer le pret FDI et son echeancier'),
  ('loan.view',                  'fdi',          'Consulter le pret FDI'),
  ('invoice.manage',             'ventes',       'Gerer devis, factures et avoirs'),
  ('payment.record',             'ventes',       'Enregistrer un paiement client/fournisseur'),
  ('subscription.manage',        'ventes',       'Gerer les abonnements (Standard/Pro/sponsoring)'),
  ('customer.manage',            'ventes',       'Gerer les fiches clients'),
  ('asset.manage',               'immobilisations', 'Gerer les immobilisations'),
  ('asset.view',                 'immobilisations', 'Consulter les immobilisations'),
  ('payroll.prepare',            'payroll',      'Preparer une paie'),
  ('payroll.approve',            'payroll',      'Approuver une paie avant paiement'),
  ('payroll.pay',                'payroll',      'Marquer une paie comme payee'),
  ('payroll.view_all',           'payroll',      'Consulter la paie de tous les employes'),
  ('payroll.view_own',           'payroll',      'Consulter sa propre fiche de paie'),
  ('advance.request',            'payroll',      'Demander une avance sur salaire pour soi-meme'),
  ('advance.approve',            'payroll',      'Approuver une avance sur salaire'),
  ('crm.manage',                 'crm',          'Gerer prospects/visites de son equipe'),
  ('crm.view_own',               'crm',          'Consulter ses propres prospects/visites'),
  ('crm.view_all',               'crm',          'Consulter l''ensemble du CRM terrain'),
  ('commission.manage',          'crm',          'Gerer les regles et versements de commission'),
  ('document.upload',            'documents',    'Deposer un document'),
  ('document.view_confidential', 'documents',    'Consulter un document confidentiel (RH/finance)'),
  ('audit.view',                 'administration','Consulter le journal d''audit'),
  ('user.manage',                'administration','Inviter/suspendre des utilisateurs'),
  ('role.manage',                'administration','Assigner/revoquer des roles'),
  ('permission.override',        'administration','Accorder/retirer une permission individuelle'),
  ('settings.manage',            'administration','Modifier les parametres de l''organisation');

-- --- Matrice role_permissions par defaut ----------------------------------
-- Voir docs/permissions-matrix.md pour la justification de chaque case.
-- NOTE (correction Phase 1A) : role.manage/permission.override sont
-- reserves SUPER_ADMIN + DIRECTEUR_GENERAL ; DIRECTEUR_TECHNIQUE recoit
-- user.manage (comptes techniques) mais pas role.manage — voir le rapport
-- de cloture Phase 1A pour la correction apportee au brouillon Phase 0.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from (values
  ('SUPER_ADMIN', 'employee.create'), ('SUPER_ADMIN', 'employee.update'), ('SUPER_ADMIN', 'employee.view'),
  ('SUPER_ADMIN', 'employee.view_salary'), ('SUPER_ADMIN', 'employee.terminate'), ('SUPER_ADMIN', 'contract.manage'),
  ('SUPER_ADMIN', 'leave.request'), ('SUPER_ADMIN', 'leave.approve'), ('SUPER_ADMIN', 'attendance.manage'),
  ('SUPER_ADMIN', 'recruitment.manage'), ('SUPER_ADMIN', 'expense.create'), ('SUPER_ADMIN', 'expense.approve'),
  ('SUPER_ADMIN', 'expense.pay'), ('SUPER_ADMIN', 'expense.cancel'), ('SUPER_ADMIN', 'expense.view'),
  ('SUPER_ADMIN', 'supplier.manage'), ('SUPER_ADMIN', 'budget.manage'), ('SUPER_ADMIN', 'budget.view'),
  ('SUPER_ADMIN', 'budget.transfer'), ('SUPER_ADMIN', 'accounting.post'), ('SUPER_ADMIN', 'accounting.reverse'),
  ('SUPER_ADMIN', 'accounting.close_period'), ('SUPER_ADMIN', 'accounting.view'), ('SUPER_ADMIN', 'treasury.manage'),
  ('SUPER_ADMIN', 'treasury.reconcile'), ('SUPER_ADMIN', 'papej.view'), ('SUPER_ADMIN', 'papej.manage'),
  ('SUPER_ADMIN', 'papej.report'), ('SUPER_ADMIN', 'donation.view'), ('SUPER_ADMIN', 'donation.create'),
  ('SUPER_ADMIN', 'donation.update'), ('SUPER_ADMIN', 'donation.approve'), ('SUPER_ADMIN', 'donation.allocate'),
  ('SUPER_ADMIN', 'donation.close'), ('SUPER_ADMIN', 'donation.report'), ('SUPER_ADMIN', 'grant.view'),
  ('SUPER_ADMIN', 'grant.manage'), ('SUPER_ADMIN', 'restricted_fund.manage'), ('SUPER_ADMIN', 'loan.manage'),
  ('SUPER_ADMIN', 'loan.view'), ('SUPER_ADMIN', 'invoice.manage'), ('SUPER_ADMIN', 'payment.record'),
  ('SUPER_ADMIN', 'subscription.manage'), ('SUPER_ADMIN', 'customer.manage'), ('SUPER_ADMIN', 'asset.manage'),
  ('SUPER_ADMIN', 'asset.view'), ('SUPER_ADMIN', 'payroll.prepare'), ('SUPER_ADMIN', 'payroll.approve'),
  ('SUPER_ADMIN', 'payroll.pay'), ('SUPER_ADMIN', 'payroll.view_all'), ('SUPER_ADMIN', 'payroll.view_own'),
  ('SUPER_ADMIN', 'advance.request'), ('SUPER_ADMIN', 'advance.approve'), ('SUPER_ADMIN', 'crm.manage'),
  ('SUPER_ADMIN', 'crm.view_own'), ('SUPER_ADMIN', 'crm.view_all'), ('SUPER_ADMIN', 'commission.manage'),
  ('SUPER_ADMIN', 'document.upload'), ('SUPER_ADMIN', 'document.view_confidential'), ('SUPER_ADMIN', 'audit.view'),
  ('SUPER_ADMIN', 'user.manage'), ('SUPER_ADMIN', 'role.manage'), ('SUPER_ADMIN', 'permission.override'),
  ('SUPER_ADMIN', 'settings.manage'),

  ('DIRECTEUR_GENERAL', 'employee.create'), ('DIRECTEUR_GENERAL', 'employee.update'), ('DIRECTEUR_GENERAL', 'employee.view'),
  ('DIRECTEUR_GENERAL', 'employee.terminate'), ('DIRECTEUR_GENERAL', 'contract.manage'), ('DIRECTEUR_GENERAL', 'leave.request'),
  ('DIRECTEUR_GENERAL', 'leave.approve'), ('DIRECTEUR_GENERAL', 'attendance.manage'), ('DIRECTEUR_GENERAL', 'recruitment.manage'),
  ('DIRECTEUR_GENERAL', 'expense.create'), ('DIRECTEUR_GENERAL', 'expense.approve'), ('DIRECTEUR_GENERAL', 'expense.cancel'),
  ('DIRECTEUR_GENERAL', 'expense.view'), ('DIRECTEUR_GENERAL', 'budget.manage'), ('DIRECTEUR_GENERAL', 'budget.view'),
  ('DIRECTEUR_GENERAL', 'budget.transfer'), ('DIRECTEUR_GENERAL', 'accounting.close_period'), ('DIRECTEUR_GENERAL', 'accounting.view'),
  ('DIRECTEUR_GENERAL', 'papej.view'), ('DIRECTEUR_GENERAL', 'papej.manage'), ('DIRECTEUR_GENERAL', 'papej.report'),
  ('DIRECTEUR_GENERAL', 'donation.view'), ('DIRECTEUR_GENERAL', 'donation.create'), ('DIRECTEUR_GENERAL', 'donation.update'),
  ('DIRECTEUR_GENERAL', 'donation.approve'), ('DIRECTEUR_GENERAL', 'donation.allocate'), ('DIRECTEUR_GENERAL', 'donation.close'),
  ('DIRECTEUR_GENERAL', 'donation.report'), ('DIRECTEUR_GENERAL', 'grant.view'), ('DIRECTEUR_GENERAL', 'grant.manage'),
  ('DIRECTEUR_GENERAL', 'restricted_fund.manage'), ('DIRECTEUR_GENERAL', 'loan.manage'), ('DIRECTEUR_GENERAL', 'loan.view'),
  ('DIRECTEUR_GENERAL', 'subscription.manage'), ('DIRECTEUR_GENERAL', 'customer.manage'), ('DIRECTEUR_GENERAL', 'asset.manage'),
  ('DIRECTEUR_GENERAL', 'asset.view'), ('DIRECTEUR_GENERAL', 'payroll.approve'), ('DIRECTEUR_GENERAL', 'payroll.view_own'),
  ('DIRECTEUR_GENERAL', 'advance.request'), ('DIRECTEUR_GENERAL', 'advance.approve'), ('DIRECTEUR_GENERAL', 'crm.manage'),
  ('DIRECTEUR_GENERAL', 'crm.view_own'), ('DIRECTEUR_GENERAL', 'crm.view_all'), ('DIRECTEUR_GENERAL', 'commission.manage'),
  ('DIRECTEUR_GENERAL', 'document.upload'), ('DIRECTEUR_GENERAL', 'document.view_confidential'), ('DIRECTEUR_GENERAL', 'audit.view'),
  ('DIRECTEUR_GENERAL', 'user.manage'), ('DIRECTEUR_GENERAL', 'role.manage'), ('DIRECTEUR_GENERAL', 'permission.override'),
  ('DIRECTEUR_GENERAL', 'settings.manage'),

  ('DIRECTEUR_TECHNIQUE', 'expense.create'), ('DIRECTEUR_TECHNIQUE', 'expense.view'), ('DIRECTEUR_TECHNIQUE', 'asset.manage'),
  ('DIRECTEUR_TECHNIQUE', 'asset.view'), ('DIRECTEUR_TECHNIQUE', 'payroll.view_own'), ('DIRECTEUR_TECHNIQUE', 'advance.request'),
  ('DIRECTEUR_TECHNIQUE', 'leave.request'), ('DIRECTEUR_TECHNIQUE', 'document.upload'), ('DIRECTEUR_TECHNIQUE', 'audit.view'),
  ('DIRECTEUR_TECHNIQUE', 'user.manage'), ('DIRECTEUR_TECHNIQUE', 'settings.manage'),

  ('COMPTABLE', 'employee.view_salary'), ('COMPTABLE', 'expense.create'), ('COMPTABLE', 'expense.pay'),
  ('COMPTABLE', 'expense.cancel'), ('COMPTABLE', 'expense.view'), ('COMPTABLE', 'supplier.manage'),
  ('COMPTABLE', 'budget.manage'), ('COMPTABLE', 'budget.view'), ('COMPTABLE', 'budget.transfer'),
  ('COMPTABLE', 'accounting.post'), ('COMPTABLE', 'accounting.reverse'), ('COMPTABLE', 'accounting.close_period'),
  ('COMPTABLE', 'accounting.view'), ('COMPTABLE', 'treasury.manage'), ('COMPTABLE', 'treasury.reconcile'),
  ('COMPTABLE', 'papej.view'), ('COMPTABLE', 'papej.manage'), ('COMPTABLE', 'papej.report'),
  ('COMPTABLE', 'donation.view'), ('COMPTABLE', 'donation.create'), ('COMPTABLE', 'donation.update'),
  ('COMPTABLE', 'donation.allocate'), ('COMPTABLE', 'donation.report'), ('COMPTABLE', 'grant.view'),
  ('COMPTABLE', 'grant.manage'), ('COMPTABLE', 'restricted_fund.manage'), ('COMPTABLE', 'loan.manage'),
  ('COMPTABLE', 'loan.view'), ('COMPTABLE', 'invoice.manage'), ('COMPTABLE', 'payment.record'),
  ('COMPTABLE', 'customer.manage'), ('COMPTABLE', 'asset.view'), ('COMPTABLE', 'payroll.pay'),
  ('COMPTABLE', 'payroll.view_all'), ('COMPTABLE', 'payroll.view_own'), ('COMPTABLE', 'advance.request'),
  ('COMPTABLE', 'document.upload'), ('COMPTABLE', 'document.view_confidential'), ('COMPTABLE', 'leave.request'),

  ('RH', 'employee.create'), ('RH', 'employee.update'), ('RH', 'employee.view'), ('RH', 'employee.terminate'),
  ('RH', 'contract.manage'), ('RH', 'leave.request'), ('RH', 'leave.approve'), ('RH', 'attendance.manage'),
  ('RH', 'recruitment.manage'), ('RH', 'expense.create'), ('RH', 'expense.view'), ('RH', 'payroll.prepare'),
  ('RH', 'payroll.view_all'), ('RH', 'payroll.view_own'), ('RH', 'advance.request'), ('RH', 'advance.approve'),
  ('RH', 'document.upload'), ('RH', 'document.view_confidential'),

  ('MANAGER', 'leave.approve'), ('MANAGER', 'leave.request'), ('MANAGER', 'expense.create'), ('MANAGER', 'expense.approve'),
  ('MANAGER', 'expense.view'), ('MANAGER', 'budget.view'), ('MANAGER', 'payroll.view_own'), ('MANAGER', 'advance.request'),
  ('MANAGER', 'crm.manage'), ('MANAGER', 'crm.view_own'), ('MANAGER', 'crm.view_all'), ('MANAGER', 'document.upload'),

  ('AGENT_TERRAIN', 'expense.create'), ('AGENT_TERRAIN', 'leave.request'), ('AGENT_TERRAIN', 'subscription.manage'),
  ('AGENT_TERRAIN', 'payroll.view_own'), ('AGENT_TERRAIN', 'advance.request'), ('AGENT_TERRAIN', 'crm.view_own'),
  ('AGENT_TERRAIN', 'document.upload'),

  ('SUPPORT', 'leave.request'), ('SUPPORT', 'payroll.view_own'), ('SUPPORT', 'advance.request'), ('SUPPORT', 'document.upload'),

  ('EMPLOYE', 'leave.request'), ('EMPLOYE', 'payroll.view_own'), ('EMPLOYE', 'advance.request'), ('EMPLOYE', 'document.upload')
) as matrix(role_code, permission_code)
join public.roles r on r.code = matrix.role_code and r.organization_id is null
join public.permissions p on p.code = matrix.permission_code;
