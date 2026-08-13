-- MedFinder Gestion — Phase 1A
-- Corrige l'avertissement "Function Search Path Mutable" du Security
-- Advisor Supabase : ces 3 fonctions n'avaient pas de search_path fige,
-- ce qui les expose en theorie a un detournement de recherche de schema
-- (creation d'un objet malveillant dans un schema plus prioritaire dans le
-- search_path de l'appelant). Toutes les autres fonctions du projet
-- fixaient deja `set search_path` — ces trois avaient ete omises.

create or replace function app_private.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function app_private.validate_membership_role()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_membership_org uuid;
  v_role_org uuid;
begin
  select organization_id into v_membership_org
    from public.memberships where id = new.membership_id;

  if v_membership_org is null then
    raise exception 'Membership % introuvable', new.membership_id;
  end if;

  select organization_id into v_role_org
    from public.roles where id = new.role_id;

  if v_role_org is not null and v_role_org <> v_membership_org then
    raise exception
      'Le role % appartient a une autre organisation que le membership %',
      new.role_id, new.membership_id;
  end if;

  return new;
end;
$$;

create or replace function app_private.current_aal()
returns text
language sql
stable
set search_path = pg_catalog
as $$
  select coalesce(nullif(auth.jwt() ->> 'aal', ''), 'aal1');
$$;
