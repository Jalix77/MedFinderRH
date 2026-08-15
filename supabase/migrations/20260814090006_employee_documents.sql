-- MedFinder Gestion — Phase 1B
-- Documents RH : metadonnees en base + binaire dans un bucket Storage
-- PRIVE (jamais public — §47 prompt maitre). Convention de chemin :
-- {organization_id}/{employee_id}/{uuid}-{nom_fichier}. Aucun acces direct
-- au bucket : uniquement via URL signee generee cote serveur apres
-- verification de permission (voir lib/storage/employee-documents.ts).

create table public.employee_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  type text not null check (type in ('contrat_signe', 'piece_identite', 'diplome', 'cv', 'justificatif', 'autre')),
  storage_path text not null unique,
  original_filename text not null,
  version integer not null default 1 check (version >= 1),
  uploaded_by uuid references public.users (id),
  created_at timestamptz not null default now()
);

comment on table public.employee_documents is
  'Metadonnees des documents RH (§46-47). Le binaire vit dans le bucket '
  'Storage prive "employee-documents", jamais accessible sans URL signee.';

create index employee_documents_org_idx on public.employee_documents (organization_id);
create index employee_documents_employee_idx on public.employee_documents (employee_id);

alter table public.employee_documents enable row level security;

-- Determine si l'utilisateur courant peut acceder aux documents d'un
-- employe donne — reutilise par la table de metadonnees ET par les
-- policies storage.objects (chemin {org}/{employee}/...).
create or replace function app_private.can_access_employee_documents(p_org_id uuid, p_employee_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, app_private
as $$
begin
  if app_private.is_super_admin(auth.uid()) then
    return true;
  end if;
  if app_private.has_permission(auth.uid(), p_org_id, 'document.view_confidential') then
    return true;
  end if;
  if app_private.has_permission(auth.uid(), p_org_id, 'employee.view_sensitive') then
    return true;
  end if;
  return exists (
    select 1 from public.employees e
    where e.id = p_employee_id and e.organization_id = p_org_id and e.user_id = auth.uid()
  );
end;
$$;

revoke all on public.employee_documents from anon;
grant select, insert on public.employee_documents to authenticated;
revoke update, delete on public.employee_documents from authenticated;

comment on table public.employee_documents is
  'Metadonnees immuables (une nouvelle version = une nouvelle ligne, jamais '
  'de modification/suppression — §47).';

create policy employee_documents_select on public.employee_documents
  for select to authenticated
  using (app_private.can_access_employee_documents(organization_id, employee_id));

create policy employee_documents_insert on public.employee_documents
  for insert to authenticated
  with check (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'document.upload')
  );

-- --- Bucket Storage prive --------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('employee-documents', 'employee-documents', false, 20971520) -- 20 MiB
on conflict (id) do nothing;

-- storage.objects : le chemin porte organization_id/employee_id/... —
-- (storage.foldername(name))[1] = organization_id, [2] = employee_id.
create policy employee_documents_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'employee-documents'
    and app_private.can_access_employee_documents(
      (storage.foldername(name))[1]::uuid,
      (storage.foldername(name))[2]::uuid
    )
  );

create policy employee_documents_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'employee-documents'
    and (
      app_private.is_super_admin(auth.uid())
      or app_private.has_permission(auth.uid(), (storage.foldername(name))[1]::uuid, 'document.upload')
    )
  );
