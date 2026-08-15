-- MedFinder Gestion — Phase 1B
-- Nouvelles permissions requises par le module RH (departements, postes,
-- donnees employe tres sensibles). Le catalogue seede en Phase 1A
-- (20260813100011) n'est jamais modifie retroactivement — toute extension
-- passe par une nouvelle migration, comme ici.

insert into public.permissions (code, module, description) values
  ('department.manage', 'rh', 'Creer/modifier/desactiver un departement'),
  ('position.manage', 'rh', 'Creer/modifier/desactiver un poste'),
  ('employee.view_sensitive', 'rh', 'Consulter les donnees tres sensibles d''un employe (NIF, NINU, CIN, adresse, contact d''urgence, notes RH)');

-- Attribution par defaut : coherente avec la matrice existante
-- (SUPER_ADMIN, DIRECTEUR_GENERAL, RH detiennent deja employee.create/update,
-- contract.manage, recruitment.manage — les memes trois roles recoivent la
-- gestion de la structure organisationnelle et l'acces aux donnees tres
-- sensibles). Voir docs/permissions-matrix.md §3, mis a jour en meme temps
-- que cette migration.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from (values
  ('SUPER_ADMIN', 'department.manage'), ('SUPER_ADMIN', 'position.manage'), ('SUPER_ADMIN', 'employee.view_sensitive'),
  ('DIRECTEUR_GENERAL', 'department.manage'), ('DIRECTEUR_GENERAL', 'position.manage'), ('DIRECTEUR_GENERAL', 'employee.view_sensitive'),
  ('RH', 'department.manage'), ('RH', 'position.manage'), ('RH', 'employee.view_sensitive')
) as matrix(role_code, permission_code)
join public.roles r on r.code = matrix.role_code and r.organization_id is null
join public.permissions p on p.code = matrix.permission_code;
