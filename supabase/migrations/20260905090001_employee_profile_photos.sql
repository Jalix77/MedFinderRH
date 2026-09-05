-- Photos privees : seule la cle Storage est conservee, jamais une URL.
-- Les helpers INVOKER doivent pouvoir resoudre leurs appels imbriques.
-- USAGE seul : aucun CREATE/EXECUTE supplementaire, schema non expose REST.
grant usage on schema app_private to authenticated;

alter table public.employees add column photo_storage_path text;
comment on column public.employees.photo_storage_path is
  'Cle du bucket prive employee-photos : organization_id/employee_id/uuid.ext. Aucune URL.';

create function app_private.is_employee_photo_path(p_path text)
returns boolean language sql immutable strict security invoker
set search_path = ''
as $$
  select p_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$';
$$;
revoke execute on function app_private.is_employee_photo_path(text) from public, anon;
grant execute on function app_private.is_employee_photo_path(text) to authenticated;

alter table public.employees add constraint employees_photo_storage_path_check check (
  photo_storage_path is null or (
    app_private.is_employee_photo_path(photo_storage_path)
    and split_part(photo_storage_path, '/', 1) = organization_id::text
    and split_part(photo_storage_path, '/', 2) = id::text
  )
);

-- Invoker : conserve aussi la RLS employees, sans contournement privilegie.
create function app_private.can_access_employee_photo(p_org_id uuid, p_employee_id uuid)
returns boolean language sql stable security invoker
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.employees e
    where e.id = p_employee_id and e.organization_id = p_org_id
      and (app_private.is_super_admin(auth.uid())
        or app_private.has_permission(auth.uid(), p_org_id, 'employee.view')
        or e.user_id = auth.uid())
  );
$$;
revoke execute on function app_private.can_access_employee_photo(uuid, uuid) from public, anon;
grant execute on function app_private.can_access_employee_photo(uuid, uuid) to authenticated;

-- Valide AVANT tout cast : un chemin malforme doit etre refuse sans erreur UUID.
create function app_private.can_manage_employee_photo_object(p_path text)
returns boolean language plpgsql stable security invoker
set search_path = ''
as $$
declare
  org_id uuid;
  employee_id uuid;
begin
  if auth.uid() is null or not coalesce(app_private.is_employee_photo_path(p_path), false) then
    return false;
  end if;
  org_id := split_part(p_path, '/', 1)::uuid;
  employee_id := split_part(p_path, '/', 2)::uuid;
  return (app_private.is_super_admin(auth.uid())
      or app_private.has_permission(auth.uid(), org_id, 'employee.update'))
    and exists (select 1 from public.employees e where e.id = employee_id and e.organization_id = org_id);
end;
$$;
revoke execute on function app_private.can_manage_employee_photo_object(text) from public, anon;
grant execute on function app_private.can_manage_employee_photo_object(text) to authenticated;

-- employees_update accepte aussi employee.terminate : cette permission ne
-- doit jamais permettre de modifier la photo par un appel REST direct.
create function app_private.guard_employee_photo_change()
returns trigger language plpgsql security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.photo_storage_path is null then return new; end if;
  elsif new.photo_storage_path is not distinct from old.photo_storage_path then
    return new;
  end if;
  if auth.uid() is null or not (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), new.organization_id, 'employee.update')
  ) then
    raise exception 'Modification de photo non autorisee' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and not (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), old.organization_id, 'employee.update')
  ) then
    raise exception 'Modification de photo non autorisee' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function app_private.guard_employee_photo_change() from public, anon;
grant execute on function app_private.guard_employee_photo_change() to authenticated;
create trigger guard_employee_photo_change
  before insert or update on public.employees
  for each row execute function app_private.guard_employee_photo_change();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('employee-photos', 'employee-photos', false, 3145728,
  array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy employee_photos_storage_select on storage.objects
  for select to authenticated using (
    bucket_id = 'employee-photos'
    and case when app_private.is_employee_photo_path(name) then
      app_private.can_access_employee_photo(
        split_part(name, '/', 1)::uuid, split_part(name, '/', 2)::uuid)
    else false end
  );
create policy employee_photos_storage_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'employee-photos' and app_private.can_manage_employee_photo_object(name)
  );
create policy employee_photos_storage_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'employee-photos' and app_private.can_manage_employee_photo_object(name)
  );
-- Pas d'UPDATE/upsert : chaque remplacement cree un nouvel objet UUID.
