-- MedFinder Gestion — Phase 1A
-- Numerotation automatique configurable (docs/accounting-design.md §11).
-- Aucune entite metier ne consomme encore de numero en Phase 1A (les
-- dépenses/factures/etc. arrivent en Phase 1B+), mais le socle est mis en
-- place et teste des maintenant via l'appel RPC direct.

create table public.numbering_sequences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  entity_type text not null,
  -- Gabarit avec jetons {year} et {seq:04d} (largeur de remplissage a zero
  -- configurable au format {seq:0Nd}).
  prefix_pattern text not null check (prefix_pattern like '%{seq%'),
  current_value integer not null default 0 check (current_value >= 0),
  reset_rule text not null default 'never' check (reset_rule in ('never', 'yearly')),
  last_reset_year integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, entity_type)
);

comment on table public.numbering_sequences is
  'Compteurs de numerotation par organisation et type d''entite. '
  'Incrementation atomique exclusivement via public.next_number() (verrou '
  'de ligne SELECT ... FOR UPDATE) — jamais de lecture-puis-ecriture cote '
  'application, qui produirait des doublons sous concurrence.';

create trigger set_updated_at
  before update on public.numbering_sequences
  for each row execute function app_private.set_updated_at();

alter table public.numbering_sequences enable row level security;

create or replace function public.next_number(p_org_id uuid, p_entity_type text)
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
  if not app_private.is_active_member(auth.uid(), p_org_id) then
    raise exception 'Non autorise pour cette organisation';
  end if;

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

  -- Extrait la largeur du jeton {seq:0Nd} (par defaut 4).
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

comment on function public.next_number is
  'Genere le prochain numero pour une organisation/type d''entite donne, de '
  'maniere atomique (verrou de ligne). Ex.: EMP-0001, DEP-2026-0001.';

revoke all on function public.next_number(uuid, text) from public;
grant execute on function public.next_number(uuid, text) to authenticated;
