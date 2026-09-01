-- MedFinder Gestion — Phase 2D, correctif : agregat sur uuid.
--
-- DEFAUT CORRIGE
-- --------------
-- public.propose_bank_reconciliation() selectionnait le mouvement candidat
-- avec `min(m.id)`. `m.id` est de type uuid et PostgreSQL ne fournit pas
-- d'agregat min(uuid) sur cette instance : tout appel a la RPC levait
--   42883 — function min(uuid) does not exist
-- Le defaut etait latent (PL/pgSQL ne resout les identifiants de fonction
-- qu'a l'execution du corps) et n'a pu apparaitre qu'apres l'application de
-- 20260830090001.
--
-- PORTEE DU CORRECTIF
-- -------------------
-- Un seul remplacement dans le corps :
--   min(m.id)  ->  (array_agg(m.id))[1]
-- array_agg accepte les uuid. La valeur n'est lue que dans la branche
-- `v_candidate_count = 1`, ou l'agregat ne contient qu'un seul element : le
-- determinisme « exactement un candidat, sinon aucune proposition » est
-- strictement inchange.
--
-- Tout le reste du corps est identique a 20260830090001. Aucune autre
-- fonction, table, policy ou permission n'est touchee. `create or replace`
-- conserve l'ACL existante (revoke public / grant authenticated).

create or replace function public.propose_bank_reconciliation(
  p_import_id uuid,
  p_date_tolerance_days integer default 3
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_import public.bank_statement_imports%rowtype;
  v_line record;
  v_candidate uuid;
  v_candidate_count integer;
  v_candidate_date date;
  v_proposed integer := 0;
  v_ambiguous integer := 0;
  v_none integer := 0;
begin
  select * into v_import from public.bank_statement_imports where id = p_import_id;
  if not found then
    return jsonb_build_object('success', false, 'error', 'import_not_found');
  end if;

  if not (app_private.is_super_admin(v_actor)
          or app_private.has_permission(v_actor, v_import.organization_id, 'treasury.reconcile')) then
    perform app_private.write_audit_log(
      v_import.organization_id, 'propose_bank_reconciliation', 'tresorerie',
      'bank_statement_import', p_import_id, null, null, 'denied');
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  if v_import.status <> 'imported' then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;
  if p_date_tolerance_days < 0 or p_date_tolerance_days > 30 then
    return jsonb_build_object('success', false, 'error', 'invalid_tolerance');
  end if;

  for v_line in
    select l.* from public.bank_statement_lines l
     where l.import_id = p_import_id and l.status = 'unreconciled'
     order by l.line_number
  loop
    -- L'identifiant du candidat est extrait via array_agg : il n'existe
    -- pas d'agregat min() sur le type uuid. min() reste utilise sur
    -- movement_date, qui est une date et supporte l'agregat.
    select count(*), (array_agg(m.id))[1], min(m.movement_date)
      into v_candidate_count, v_candidate, v_candidate_date
      from public.cash_movements m
     where m.organization_id = v_import.organization_id
       and m.treasury_account_type = v_import.treasury_account_type
       and m.treasury_account_id = v_import.treasury_account_id
       and m.currency = v_line.currency
       and m.direction = v_line.direction
       and m.amount = v_line.amount
       and m.movement_date between v_line.value_date - p_date_tolerance_days
                               and v_line.value_date + p_date_tolerance_days
       -- Un mouvement deja marque rapproche n'est plus candidat, meme si
       -- son rapprochement d'origine n'est plus visible ici.
       and m.reconciled = false
       and not exists (
         select 1 from public.bank_reconciliation_matches x
          where x.cash_movement_id = m.id and x.status in ('proposed', 'validated')
       );

    if v_candidate_count = 1 then
      insert into public.bank_reconciliation_matches (
        organization_id, statement_line_id, cash_movement_id, match_type,
        status, amount_difference, date_difference_days,
        proposed_by, created_by, updated_by
      ) values (
        v_import.organization_id, v_line.id, v_candidate, 'auto',
        'proposed', 0, abs(v_candidate_date - v_line.value_date),
        v_actor, v_actor, v_actor
      );
      update public.bank_statement_lines set status = 'proposed' where id = v_line.id;
      v_proposed := v_proposed + 1;
    elsif v_candidate_count > 1 then
      v_ambiguous := v_ambiguous + 1;
    else
      v_none := v_none + 1;
    end if;
  end loop;

  perform app_private.write_audit_log(
    v_import.organization_id, 'propose_bank_reconciliation', 'tresorerie',
    'bank_statement_import', p_import_id, null,
    jsonb_build_object('proposed', v_proposed, 'ambiguous', v_ambiguous, 'unmatched', v_none),
    'success');

  return jsonb_build_object(
    'success', true, 'proposed', v_proposed,
    'ambiguous', v_ambiguous, 'unmatched', v_none);
end;
$$;

-- =====================================================================
-- AUTO-VERIFICATION
-- =====================================================================
-- Garde-fou etabli en Phase 2C apres deux migrations correctives restees
-- silencieusement sans effet : la migration echoue bruyamment si le
-- nouveau corps n'est pas reellement installe.
do $verify$
declare
  v_src text;
  v_cfg text[];
begin
  select p.prosrc, p.proconfig
    into v_src, v_cfg
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'propose_bank_reconciliation';

  if not found then
    raise exception 'ECHEC : public.propose_bank_reconciliation est absente';
  end if;

  if not exists (
    select 1 from unnest(coalesce(v_cfg, '{}'::text[])) cfg
     where cfg in ('search_path=""', 'search_path=')
  ) then
    raise exception
      'ECHEC : public.propose_bank_reconciliation n''a plus un search_path exactement vide (proconfig = %)',
      coalesce(v_cfg::text, 'NULL');
  end if;

  if v_src not like '%(array_agg(m.id))[1]%' then
    raise exception
      'ECHEC : le corps installe ne contient pas (array_agg(m.id))[1] — le correctif n''a pas pris effet';
  end if;

  if v_src like '%min(m.id)%' then
    raise exception
      'ECHEC : le corps installe contient encore min(m.id) — le correctif n''a pas pris effet';
  end if;

  raise notice 'OK : correctif Phase 2D (agregat uuid) applique et verifie.';
end;
$verify$;
