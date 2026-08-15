-- MedFinder Gestion — Phase 1B
-- public.next_number() (Phase 1A) exige qu'une ligne numbering_sequences
-- existe deja pour l'organisation/type d'entite, sinon il leve une
-- exception explicite. Plutot que d'exiger une configuration manuelle
-- avant la toute premiere creation d'employe, on seede un defaut
-- raisonnable automatiquement a la creation de l'organisation — et on
-- comble les organisations deja existantes (creees en Phase 1A avant ce
-- trigger). Le comptable/SUPER_ADMIN reste libre de modifier le gabarit
-- ensuite via une mise a jour directe de numbering_sequences (deja
-- protegee par RLS, lecture ouverte/ecriture reservee en pratique aux
-- flux qui la gerent).

create or replace function app_private.seed_default_numbering_sequences()
returns trigger
language plpgsql
security definer
set search_path = public, app_private
as $$
begin
  insert into public.numbering_sequences (organization_id, entity_type, prefix_pattern, reset_rule)
  values (new.id, 'employee', 'EMP-{seq:04d}', 'never')
  on conflict (organization_id, entity_type) do nothing;

  return new;
end;
$$;

create trigger seed_default_numbering_sequences
  after insert on public.organizations
  for each row execute function app_private.seed_default_numbering_sequences();

-- Comble les organisations existantes (Phase 1A) qui n'ont pas encore de
-- sequence "employee".
insert into public.numbering_sequences (organization_id, entity_type, prefix_pattern, reset_rule)
select o.id, 'employee', 'EMP-{seq:04d}', 'never'
from public.organizations o
where not exists (
  select 1 from public.numbering_sequences ns
  where ns.organization_id = o.id and ns.entity_type = 'employee'
);

-- --------------------------------------------------------------------
-- Refactor : extrait la logique d'incrementation atomique de
-- public.next_number() (Phase 1A) dans une fonction interne
-- (app_private, jamais exposee via RPC) reutilisable par des triggers
-- internes (ex. auto-assignation du matricule employe, Phase 1B) sans
-- dupliquer le code ni re-verifier une permission deja validee par la
-- policy RLS de la table appelante.
-- --------------------------------------------------------------------

create or replace function app_private.next_number_internal(p_org_id uuid, p_entity_type text)
returns text
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_seq public.numbering_sequences%rowtype;
  v_year int := extract(year from now())::int;
  v_number int;
  v_width int;
  v_formatted text;
begin
  select * into v_seq
    from public.numbering_sequences
    where organization_id = p_org_id and entity_type = p_entity_type
    for update;

  if not found then
    raise exception
      'Aucune sequence de numerotation configuree pour % dans l''organisation %',
      p_entity_type, p_org_id;
  end if;

  if v_seq.reset_rule = 'yearly' and coalesce(v_seq.last_reset_year, 0) <> v_year then
    v_number := 1;
  else
    v_number := v_seq.current_value + 1;
  end if;

  update public.numbering_sequences
     set current_value = v_number,
         last_reset_year = case when reset_rule = 'yearly' then v_year else last_reset_year end
   where id = v_seq.id;

  v_width := coalesce(
    (regexp_match(v_seq.prefix_pattern, '\{seq:0(\d)d\}'))[1]::int,
    4
  );

  v_formatted := replace(v_seq.prefix_pattern, '{year}', v_year::text);
  v_formatted := regexp_replace(
    v_formatted, '\{seq:0\d+d\}', lpad(v_number::text, v_width, '0')
  );

  return v_formatted;
end;
$$;

comment on function app_private.next_number_internal is
  'Logique partagee entre public.next_number() (RPC, verifie is_active_member) '
  'et les triggers internes (ex. matricule employe) qui s''executent deja '
  'dans un contexte autorise par RLS — jamais exposee directement.';

-- public.next_number() devient un mince wrapper : verifie l'appartenance,
-- delegue l'incrementation atomique a la fonction interne.
create or replace function public.next_number(p_org_id uuid, p_entity_type text)
returns text
language plpgsql
security definer
set search_path = public, app_private
as $$
begin
  if not app_private.is_active_member(auth.uid(), p_org_id) then
    raise exception 'Non autorise pour cette organisation';
  end if;

  return app_private.next_number_internal(p_org_id, p_entity_type);
end;
$$;
