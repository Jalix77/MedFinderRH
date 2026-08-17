-- MedFinder Gestion — Phase 2A — Plan comptable : seed minimal MedFinder
-- + immutabilite defense-en-profondeur pour tout compte deja utilise
-- (docs/phase-2-plan.md §0.5/§5A, decision actee par Jean Alix Pierre le
-- 17/08/2026).
--
-- Seed ~18 comptes courants (tresorerie, creances, immobilisations,
-- amortissements, dettes fournisseurs, emprunt FDI, capital, revenus,
-- charges) — ni vide, ni surdimensionne. Entierement administrable
-- ensuite (le comptable cree/desactive librement). ON CONFLICT DO NOTHING :
-- n'ecrase ni ne renomme jamais un compte deja cree manuellement pendant
-- Phase 1C — purement additif par code exact.

create or replace function app_private.seed_default_chart_of_accounts()
returns trigger
language plpgsql
security definer
set search_path = public, app_private
as $$
begin
  insert into public.chart_of_accounts (organization_id, code, label, type) values
    (new.id, '1000', 'Caisse',                                    'asset'),
    (new.id, '1010', 'Banque',                                    'asset'),
    (new.id, '1020', 'Mobile Money',                               'asset'),
    (new.id, '1100', 'Creances clients',                           'asset'),
    (new.id, '1500', 'Immobilisations — materiel informatique',     'asset'),
    (new.id, '1510', 'Immobilisations — materiel de bureau',        'asset'),
    (new.id, '1590', 'Amortissements cumules',                      'asset'),
    (new.id, '2100', 'Dettes fournisseurs',                         'liability'),
    (new.id, '2200', 'Emprunt FDI',                                 'liability'),
    (new.id, '2900', 'Fonds affectes (dons/subventions)',           'liability'),
    (new.id, '3000', 'Capital / Apport fondateurs',                 'equity'),
    (new.id, '3900', 'Resultat de l''exercice',                     'equity'),
    (new.id, '4000', 'Revenus — abonnements',                       'revenue'),
    (new.id, '4010', 'Revenus — publicite/sponsoring',               'revenue'),
    (new.id, '4900', 'Revenus PAPEJ',                                'revenue'),
    (new.id, '6000', 'Charges — depenses operationnelles',           'expense'),
    (new.id, '6100', 'Charges — paie',                               'expense'),
    (new.id, '6200', 'Charges financieres — interets FDI',           'expense'),
    (new.id, '6800', 'Dotations aux amortissements',                 'expense')
  on conflict (organization_id, code) do nothing;

  return new;
end;
$$;

revoke execute on function app_private.seed_default_chart_of_accounts() from public;

create trigger seed_default_chart_of_accounts
  after insert on public.organizations
  for each row execute function app_private.seed_default_chart_of_accounts();

-- Comble les organisations existantes (Phase 1A-1C), meme patron que
-- seed_default_journals en 1C.1.
insert into public.chart_of_accounts (organization_id, code, label, type)
select o.id, a.code, a.label, a.type
from public.organizations o
cross join (values
  ('1000', 'Caisse',                                    'asset'),
  ('1010', 'Banque',                                    'asset'),
  ('1020', 'Mobile Money',                               'asset'),
  ('1100', 'Creances clients',                           'asset'),
  ('1500', 'Immobilisations — materiel informatique',     'asset'),
  ('1510', 'Immobilisations — materiel de bureau',        'asset'),
  ('1590', 'Amortissements cumules',                      'asset'),
  ('2100', 'Dettes fournisseurs',                         'liability'),
  ('2200', 'Emprunt FDI',                                 'liability'),
  ('2900', 'Fonds affectes (dons/subventions)',           'liability'),
  ('3000', 'Capital / Apport fondateurs',                 'equity'),
  ('3900', 'Resultat de l''exercice',                     'equity'),
  ('4000', 'Revenus — abonnements',                       'revenue'),
  ('4010', 'Revenus — publicite/sponsoring',               'revenue'),
  ('4900', 'Revenus PAPEJ',                                'revenue'),
  ('6000', 'Charges — depenses operationnelles',           'expense'),
  ('6100', 'Charges — paie',                               'expense'),
  ('6200', 'Charges financieres — interets FDI',           'expense'),
  ('6800', 'Dotations aux amortissements',                 'expense')
) as a(code, label, type)
where not exists (
  select 1 from public.chart_of_accounts existing
  where existing.organization_id = o.id and existing.code = a.code
);

-- --- Immutabilite : un compte utilise par au moins une ligne d'ecriture -
-- --- ne peut jamais etre physiquement supprime, meme via service_role --
-- Defense en profondeur : DELETE est deja revoque a "authenticated" depuis
-- 1C.1 (grants table-level), mais ce trigger ferme aussi le chemin
-- service_role/futur bug de policy — meme discipline exacte que
-- accounting_periods_immutable_once_closed / journal_entries_immutable_once_posted.

create or replace function app_private.chart_of_accounts_immutable_if_used()
returns trigger
language plpgsql
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

create trigger chart_of_accounts_immutable_if_used
  before delete on public.chart_of_accounts
  for each row execute function app_private.chart_of_accounts_immutable_if_used();
