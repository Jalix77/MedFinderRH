-- MedFinder Gestion — Correctif de securite demande par Jean Alix Pierre
-- apres rejeu REEL du Security Advisor Supabase sur le projet MedFinder
-- Gestion (18/08/2026), qui a signale :
--   function_search_path_mutable (WARN)
--     -> app_private.chart_of_accounts_immutable_if_used
--
-- =====================================================================
-- 1. POURQUOI MES PROPRES VERIFICATIONS NE L'ONT PAS DETECTE (aveu explicite)
-- =====================================================================
-- La fonction public.debug_security_definer_without_search_path
-- (20260816090013) filtre sur `p.prosecdef` — SECURITY DEFINER
-- UNIQUEMENT. Or cette fonction-ci est une fonction TRIGGER ordinaire,
-- sans SECURITY DEFINER : elle etait donc STRUCTURELLEMENT hors du champ
-- de ma verification, qui ne pouvait pas la detecter, quel que soit le
-- nombre de rejeux. Le lint Supabase `function_search_path_mutable`,
-- lui, couvre TOUTES les fonctions du schema, sans condition sur
-- SECURITY DEFINER.
--
-- Consequence assumee : une verification interne `debug_*` ne vaut PAS
-- le Security Advisor reel, et ne doit jamais etre presentee comme tel.
-- Le point 2 ci-dessous ferme ce trou de detection de facon permanente.
--
-- =====================================================================
-- 2. PERIMETRE REEL DU DEFAUT (verifie, pas suppose)
-- =====================================================================
-- Balayage exhaustif des 78 fonctions app_private/public definies par
-- l'ensemble des migrations (derniere definition retenue pour chacune) :
-- UNE SEULE est depourvue de `set search_path` — exactement celle
-- signalee par l'Advisor. Aucune autre fonction a corriger ; ce
-- correctif est donc complet et non partiel.
--
-- =====================================================================
-- 3. CORRECTIF — meme standard exact que 20260816090014
-- =====================================================================
-- La fonction ne reference qu'un seul objet de schema,
-- `public.journal_entry_lines`, DEJA pleinement qualifie ; les autres
-- references sont des pseudo-variables de trigger (OLD.*) et des types
-- de base (resolus via pg_catalog, toujours implicitement present).
-- `search_path = ''` (vide) est donc applicable tel quel et constitue le
-- choix le plus strict possible — strictement plus sur que
-- `public, app_private` : toute reference non qualifiee introduite plus
-- tard echouerait a l'execution plutot que de risquer une resolution
-- detournee vers un schema hostile. C'est le standard deja applique aux
-- 5 fonctions trigger corrigees en Phase 1C (20260816090014).
--
-- CREATE OR REPLACE strict : corps de la fonction rigoureusement
-- IDENTIQUE (aucune ligne de logique metier modifiee), seule la clause
-- `set search_path = ''` est ajoutee. Le trigger deja attache
-- (chart_of_accounts_immutable_if_used sur public.chart_of_accounts)
-- reste en place et pointe vers la meme fonction — aucun DROP/CREATE de
-- trigger, donc aucune fenetre pendant laquelle la protection
-- d'immutabilite serait levee.

create or replace function app_private.chart_of_accounts_immutable_if_used()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_usage_count int;
begin
  select count(*) into v_usage_count
    from public.journal_entry_lines
    where account_id = OLD.id;

  if v_usage_count > 0 then
    raise exception 'Compte % (%) deja utilise par % ligne(s) d''ecriture — suppression interdite (desactivation uniquement)',
      OLD.code, OLD.id, v_usage_count;
  end if;

  return OLD;
end;
$$;

revoke execute on function app_private.chart_of_accounts_immutable_if_used() from public;

-- =====================================================================
-- 4. FERMETURE DU TROU DE DETECTION (pour que ce cas ne se reproduise pas)
-- =====================================================================
-- Nouvelle verification interne alignee sur le lint Supabase reel :
-- TOUTES les fonctions, pas seulement les SECURITY DEFINER. Les
-- fonctions du langage `c`/`internal` (extensions : pgcrypto, uuid-ossp,
-- pg_graphql...) sont exclues — non modifiables par nous et hors du
-- perimetre du lint applicatif.
--
-- Cette fonction NE REMPLACE PAS le Security Advisor : elle sert a
-- attraper une regression entre deux rejeux manuels de l'Advisor, jamais
-- a affirmer qu'aucun avertissement Advisor n'existe.

create or replace function public.debug_functions_with_mutable_search_path(p_schema text default 'public')
returns table (function_signature text, is_security_definer boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')',
    p.prosecdef
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  join pg_catalog.pg_language l on l.oid = p.prolang
  where n.nspname = p_schema
    and l.lanname not in ('c', 'internal') -- fonctions d'extension : hors perimetre
    and not exists (
      select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) as cfg
      where cfg like 'search_path=%'
    )
  order by 1
$$;

comment on function public.debug_functions_with_mutable_search_path is
  'Equivalent interne du lint Supabase function_search_path_mutable — '
  'couvre TOUTES les fonctions, contrairement a '
  'debug_security_definer_without_search_path qui filtre sur prosecdef '
  'et avait laisse passer app_private.chart_of_accounts_immutable_if_used '
  '(signalee par le Security Advisor reel le 18/08/2026). Ne remplace '
  'jamais le Security Advisor : sert a detecter une regression entre '
  'deux rejeux manuels.';

revoke all on function public.debug_functions_with_mutable_search_path(text) from public;
revoke execute on function public.debug_functions_with_mutable_search_path(text) from anon, authenticated;
grant execute on function public.debug_functions_with_mutable_search_path(text) to service_role;
