-- MedFinder Gestion — Hardening cloud demande suite aux exports reels
-- Security Advisor : 5 fonctions app_private (toutes des fonctions
-- TRIGGER) n'avaient aucun `set search_path` explicite
-- (function_search_path_mutable, WARN).
--
-- Analyse individuelle avant correction (aucune n'a ete modifiee a
-- l'aveugle) :
-- - accounting_periods_immutable_once_closed : ne reference que
--   OLD/NEW/TG_OP (pseudo-variables de trigger), aucun objet de schema.
-- - journal_entries_immutable_once_posted : idem, aucun objet de schema.
-- - journal_entry_lines_immutable_once_posted : reference
--   public.journal_entries, deja qualifie explicitement.
-- - enforce_budget_line_org_consistency : reference public.budgets, deja
--   qualifie explicitement.
-- - prevent_direct_grant_receipt_change : appelle uniquement
--   current_setting() (pg_catalog, toujours resolu quel que soit
--   search_path — pg_catalog est implicitement prepende).
--
-- Aucune des 5 ne depend d'une resolution non qualifiee d'objet dans
-- public/app_private : `search_path = ''` (vide) est donc le choix le
-- plus sur possible ici, strictement plus strict que
-- `public, app_private` — toute reference non qualifiee future y
-- echouerait a la compilation plutot que de risquer une resolution
-- hostile (recherche de schema detournee). CREATE OR REPLACE strict :
-- corps de fonction et triggers deja attaches inchanges, seule la clause
-- `set search_path` est ajoutee.

create or replace function app_private.accounting_periods_immutable_once_closed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if TG_OP = 'DELETE' then
    if OLD.status = 'closed' then
      raise exception 'Periode comptable % deja fermee — suppression interdite', OLD.id;
    end if;
    return OLD;
  end if;

  if OLD.status = 'closed' then
    raise exception 'Periode comptable % deja fermee — modification interdite (aucune reouverture silencieuse)', OLD.id;
  end if;
  return NEW;
end;
$$;

create or replace function app_private.journal_entries_immutable_once_posted()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if TG_OP = 'DELETE' then
    if OLD.status = 'posted' then
      raise exception 'Ecriture comptable % deja comptabilisee — suppression interdite (contre-passation requise)', OLD.id;
    end if;
    return OLD;
  end if;

  if OLD.status = 'posted' then
    raise exception 'Ecriture comptable % deja comptabilisee — modification interdite (contre-passation requise)', OLD.id;
  end if;
  return NEW;
end;
$$;

create or replace function app_private.journal_entry_lines_immutable_once_posted()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_entry_status text;
begin
  select status into v_entry_status from public.journal_entries
    where id = coalesce(OLD.entry_id, NEW.entry_id);

  if v_entry_status = 'posted' then
    if TG_OP = 'DELETE' then
      raise exception 'Ligne d''ecriture comptable % : ecriture deja comptabilisee — suppression interdite', OLD.id;
    end if;
    raise exception 'Ligne d''ecriture comptable % : ecriture deja comptabilisee — modification interdite', OLD.id;
  end if;

  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;

create or replace function app_private.enforce_budget_line_org_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_budget_org uuid;
begin
  select organization_id into v_budget_org from public.budgets where id = NEW.budget_id;
  if v_budget_org is null then
    raise exception 'Budget % introuvable', NEW.budget_id;
  end if;
  if v_budget_org <> NEW.organization_id then
    raise exception 'Incoherence organisation : budget_line.organization_id (%) <> budgets.organization_id (%)',
      NEW.organization_id, v_budget_org;
  end if;
  return NEW;
end;
$$;

create or replace function app_private.prevent_direct_grant_receipt_change()
returns trigger
language plpgsql
set search_path = ''
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
