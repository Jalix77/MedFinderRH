-- MedFinder Gestion — Phase 1C, correctif post-verification cloud (3)
-- Trouvaille (rejeu de tests/integration/papej.test.ts contre le projet
-- cloud) : la restriction "amount_received non modifiable directement"
-- (§9 du plan corrige) reposait sur un GRANT UPDATE colonne-par-colonne
-- (grant update (name, donor_name, ...) on grants to authenticated,
-- amount_received volontairement absent de la liste). Empiriquement
-- inefficace sur ce projet — confirme par un appel direct reproduit hors
-- suite de tests (UPDATE grants SET amount_received = 777 reussit malgre
-- l'absence de amount_received dans la liste de colonnes grantees). Cause
-- exacte non confirmee (possible interaction entre RLS et les privileges
-- colonne-par-colonne differente de l'hypothese initiale) — plutot que de
-- continuer a deboguer un mecanisme dont la fiabilite reste incertaine,
-- remplace par un trigger explicite, dont le comportement est verifiable
-- directement et sans ambiguite (meme famille que les triggers
-- d'immutabilite deja utilises en 1C.1/1C.3).
--
-- Nouveau mecanisme : un GUC local a la transaction
-- ('app.trusted_grant_receipt'), positionne UNIQUEMENT par
-- do_record_grant_receipt() juste avant son propre UPDATE, jamais
-- accessible ni positionnable par un client (aucune fonction ne l'expose).
-- Le trigger refuse tout changement de amount_received/received_date tant
-- que ce GUC n'est pas exactement 'true' pour la transaction courante.

create or replace function app_private.prevent_direct_grant_receipt_change()
returns trigger
language plpgsql
as $$
begin
  if NEW.amount_received is distinct from OLD.amount_received
     or NEW.received_date is distinct from OLD.received_date then
    if coalesce(current_setting('app.trusted_grant_receipt', true), '') <> 'true' then
      raise exception
        'amount_received/received_date ne peuvent etre modifies que via record_grant_receipt()';
    end if;
  end if;
  return NEW;
end;
$$;

revoke execute on function app_private.prevent_direct_grant_receipt_change() from public;

create trigger prevent_direct_grant_receipt_change
  before update on public.grants
  for each row execute function app_private.prevent_direct_grant_receipt_change();

-- Le GRANT table-level redevient simple (le trigger porte desormais toute
-- la restriction, verifiable sans ambiguite) — remplace le grant colonne-
-- par-colonne precedent, qui restait techniquement en place mais n'etait
-- plus la ligne de defense reelle.
grant update on public.grants to authenticated;

create or replace function app_private.do_record_grant_receipt(
  p_grant_id uuid,
  p_amount numeric,
  p_received_date date,
  p_treasury_account_type text,
  p_treasury_account_id uuid,
  p_actor uuid
) returns uuid
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_grant public.grants%rowtype;
  v_journal_code text;
  v_treasury_gl_account_id uuid;
  v_new_entry_id uuid;
begin
  if p_amount <= 0 then
    raise exception 'Montant de reception invalide: %', p_amount;
  end if;
  if p_treasury_account_type not in ('cash', 'bank', 'mobile_money') then
    raise exception 'Type de compte de tresorerie invalide: %', p_treasury_account_type;
  end if;

  select * into v_grant from public.grants where id = p_grant_id for update;
  if not found then
    raise exception 'Financement % introuvable', p_grant_id;
  end if;
  if v_grant.revenue_account_id is null then
    raise exception 'Financement % sans compte comptable de produit configure — reception impossible', p_grant_id;
  end if;

  if p_treasury_account_type = 'cash' then
    v_journal_code := 'CASH';
    select gl_account_id into v_treasury_gl_account_id from public.cash_accounts
      where id = p_treasury_account_id and organization_id = v_grant.organization_id for update;
  elsif p_treasury_account_type = 'bank' then
    v_journal_code := 'BANK';
    select gl_account_id into v_treasury_gl_account_id from public.bank_accounts
      where id = p_treasury_account_id and organization_id = v_grant.organization_id for update;
  else
    v_journal_code := 'MISC';
    select gl_account_id into v_treasury_gl_account_id from public.mobile_money_accounts
      where id = p_treasury_account_id and organization_id = v_grant.organization_id for update;
  end if;
  if v_treasury_gl_account_id is null then
    raise exception 'Compte de tresorerie % introuvable pour cette organisation', p_treasury_account_id;
  end if;

  if p_treasury_account_type = 'cash' then
    update public.cash_accounts set current_balance = current_balance + p_amount where id = p_treasury_account_id;
  elsif p_treasury_account_type = 'bank' then
    update public.bank_accounts set current_balance = current_balance + p_amount where id = p_treasury_account_id;
  else
    update public.mobile_money_accounts set current_balance = current_balance + p_amount where id = p_treasury_account_id;
  end if;

  insert into public.cash_movements (
    organization_id, treasury_account_type, treasury_account_id, direction, amount,
    currency, movement_date, reference_type, reference_id, description, created_by, updated_by
  ) values (
    v_grant.organization_id, p_treasury_account_type, p_treasury_account_id, 'in', p_amount,
    v_grant.currency, p_received_date, 'grant', p_grant_id,
    'Reception financement ' || v_grant.name, p_actor, p_actor
  );

  v_new_entry_id := app_private.create_and_post_two_line_entry(
    v_grant.organization_id, v_journal_code, p_received_date,
    'Reception financement ' || v_grant.name, 'grant', p_grant_id,
    v_treasury_gl_account_id, v_grant.revenue_account_id,
    p_amount, v_grant.currency, 1, p_actor
  );

  -- GUC local a la transaction (is_local=true) : autorise le trigger
  -- ci-dessus pour cette seule transaction, jamais persiste ni accessible
  -- en dehors de cette fonction.
  perform set_config('app.trusted_grant_receipt', 'true', true);

  update public.grants
     set amount_received = amount_received + p_amount,
         received_date = coalesce(received_date, p_received_date)
   where id = p_grant_id;

  perform app_private.write_audit_log(
    v_grant.organization_id, 'record_grant_receipt', 'papej', 'grant', p_grant_id,
    null, jsonb_build_object('amount', p_amount, 'journal_entry_id', v_new_entry_id), 'success'
  );

  return v_new_entry_id;
end;
$$;

revoke execute on function app_private.do_record_grant_receipt(uuid, numeric, date, text, uuid, uuid) from public;
