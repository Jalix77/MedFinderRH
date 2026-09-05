-- Verification complementaire, uniquement sur la base locale avec seed DEV.
-- Executer avec psql -v ON_ERROR_STOP=1. Toutes les fixtures sont annulees.
begin;

create temporary table photo_test_context as
select
  (select id from auth.users where email = 'rh.demo@medfinder.test') as rh_id,
  (select id from auth.users where email = 'super.demo@medfinder.test') as super_id,
  (select id from auth.users where email = 'manager.demo@medfinder.test') as viewer_id,
  (select id from auth.users where email = 'employe.demo@medfinder.test') as self_id,
  (select id from public.organizations where tax_id = 'DEMO-A') as org_a,
  (select id from public.organizations where tax_id = 'DEMO-B') as org_b,
  (select e.id from public.employees e join auth.users u on u.id = e.user_id
    where u.email = 'employe.demo@medfinder.test') as employee_id,
  gen_random_uuid() as foreign_employee_id;
grant select on photo_test_context to authenticated;

-- Le seed MANAGER n'a pas employee.view : octroi isole, annule par ROLLBACK.
insert into public.user_permission_overrides (user_id, organization_id, permission_id, effect, reason, granted_by)
select viewer_id, org_a, p.id, 'grant', 'Test photo lecture seule', super_id
from photo_test_context cross join public.permissions p where p.code = 'employee.view';

insert into public.employees (id, organization_id, matricule, first_name, last_name, hire_date)
select foreign_employee_id, org_b, '', 'Photo', 'Test rollback', '2026-01-01' from photo_test_context;

create function pg_temp.photo_assert(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is distinct from true then raise exception 'Photo RLS: %', message; end if;
end;
$$;

select pg_temp.photo_assert(
  (select not public and file_size_limit = 3145728
    and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
    from storage.buckets where id = 'employee-photos'), 'bucket prive et limites');
select pg_temp.photo_assert(
  not has_schema_privilege('authenticated', 'app_private', 'CREATE')
  and not has_function_privilege('anon', 'app_private.can_access_employee_photo(uuid,uuid)', 'EXECUTE'),
  'aucun CREATE ou EXECUTE anonyme');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', viewer_id, 'aal', 'aal1')::text, true) from photo_test_context;
select pg_temp.photo_assert(app_private.can_access_employee_photo(org_a, employee_id), 'employee.view lit') from photo_test_context;
select pg_temp.photo_assert(not app_private.can_manage_employee_photo_object(
  org_a || '/' || employee_id || '/' || gen_random_uuid() || '.png'), 'viewer ne modifie pas') from photo_test_context;

select set_config('request.jwt.claims', json_build_object('sub', self_id, 'aal', 'aal1')::text, true) from photo_test_context;
select pg_temp.photo_assert(app_private.can_access_employee_photo(org_a, employee_id), 'self lit sa photo') from photo_test_context;
select pg_temp.photo_assert(not app_private.can_access_employee_photo(org_b, foreign_employee_id), 'self ne lit pas autrui') from photo_test_context;

select set_config('request.jwt.claims', json_build_object('sub', rh_id, 'aal', 'aal1')::text, true) from photo_test_context;
select pg_temp.photo_assert(app_private.can_manage_employee_photo_object(
  org_a || '/' || employee_id || '/' || gen_random_uuid() || '.webp'), 'employee.update modifie') from photo_test_context;
select pg_temp.photo_assert(not app_private.can_manage_employee_photo_object(
  org_b || '/' || employee_id || '/' || gen_random_uuid() || '.png')
  and not app_private.can_manage_employee_photo_object('invalid/uuid/photo.png'), 'scope et chemin stricts') from photo_test_context;

do $$
begin
  begin
    update public.employees set photo_storage_path = 'https://example.test/photo?token=test'
    where id = (select employee_id from photo_test_context);
    raise exception 'Une URL a ete acceptee en base';
  exception when check_violation then null;
  end;
end;
$$;

select set_config('request.jwt.claims', json_build_object('sub', super_id, 'aal', 'aal2')::text, true) from photo_test_context;
select pg_temp.photo_assert(app_private.can_access_employee_photo(org_b, foreign_employee_id), 'SUPER_ADMIN AAL2 lit hors organisation') from photo_test_context;
select pg_temp.photo_assert(app_private.can_manage_employee_photo_object(
  org_b || '/' || foreign_employee_id || '/' || gen_random_uuid() || '.jpg'), 'SUPER_ADMIN AAL2 modifie') from photo_test_context;

-- RH conserve employee.terminate mais perd temporairement employee.update.
reset role;
insert into public.user_permission_overrides (user_id, organization_id, permission_id, effect, reason, granted_by)
select rh_id, org_a, p.id, 'revoke', 'Test photo transactionnel', super_id
from photo_test_context cross join public.permissions p where p.code = 'employee.update';
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', rh_id, 'aal', 'aal1')::text, true) from photo_test_context;
do $$
declare c record;
begin
  select * into c from photo_test_context;
  perform pg_temp.photo_assert(
    app_private.has_permission(c.rh_id, c.org_a, 'employee.terminate')
    and not app_private.has_permission(c.rh_id, c.org_a, 'employee.update'), 'fixture terminate seul');
  begin
    update public.employees
      set photo_storage_path = c.org_a || '/' || c.employee_id || '/' || gen_random_uuid() || '.jpg'
      where id = c.employee_id;
    raise exception 'employee.terminate a modifie la photo';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
rollback;
select 'Photos : assertions SQL/RLS reussies, fixtures annulees' as result;
