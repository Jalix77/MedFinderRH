-- MedFinder Gestion — Phase 2C.3B, correctif.
--
-- DEFAUT REEL trouve par les tests (pas par relecture) : le trigger
-- app_private.customer_payments_immutable_once_recorded() bloquait TOUTE
-- modification de journal_entry_id et cash_movement_id, y compris leur
-- PREMIER renseignement.
--
-- Or ces deux liens ne peuvent pas etre connus au moment de l'INSERT :
-- l'ecriture comptable porte source_id = ID DU PAIEMENT, donc le paiement
-- doit exister AVANT que l'ecriture puisse etre creee. La RPC insere
-- d'abord le paiement, cree l'ecriture puis le mouvement, et rattache
-- enfin les deux. Le trigger refusait ce rattachement final avec
-- « Encaissement ENC-... comptabilise — contenu financier immuable »,
-- ce qui faisait echouer TOUT encaissement (la transaction entiere etant
-- annulee — aucun paiement fantome n'a donc jamais subsiste).
--
-- CORRECTION MINIMALE ET SURE : la transition NULL -> valeur reste
-- possible UNE SEULE FOIS (rattachement initial) ; toute modification
-- d'un lien DEJA renseigne demeure interdite. La garantie
-- d'immutabilite n'est donc pas affaiblie : un paiement ne peut jamais
-- voir son ecriture ni son mouvement REMPLACES silencieusement, et les
-- contraintes UNIQUE sur ces deux colonnes empechent toujours deux
-- paiements de partager une ecriture ou un mouvement.
--
-- Tous les autres champs financiers (montant, facture, tiers, date,
-- devise, taux, compte de tresorerie, numero, organisation) restent
-- strictement immuables des l'insertion.

create or replace function app_private.customer_payments_immutable_once_recorded()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception
      'Encaissement % comptabilise — suppression interdite (annulation motivee avec contre-passation)',
      coalesce(old.payment_number, old.id::text);
  end if;

  if old.status = 'cancelled' then
    raise exception 'Encaissement % deja annule — aucune modification possible', old.payment_number;
  end if;

  if new.amount             is distinct from old.amount
     or new.invoice_id      is distinct from old.invoice_id
     or new.third_party_id  is distinct from old.third_party_id
     or new.payment_date    is distinct from old.payment_date
     or new.currency        is distinct from old.currency
     or new.exchange_rate_to_htg is distinct from old.exchange_rate_to_htg
     or new.treasury_account_type is distinct from old.treasury_account_type
     or new.treasury_account_id   is distinct from old.treasury_account_id
     or new.payment_number   is distinct from old.payment_number
     or new.organization_id  is distinct from old.organization_id
     -- Liens comptables : rattachement initial autorise (NULL -> valeur),
     -- remplacement d'un lien deja pose interdit.
     or (old.journal_entry_id is not null
         and new.journal_entry_id is distinct from old.journal_entry_id)
     or (old.cash_movement_id is not null
         and new.cash_movement_id is distinct from old.cash_movement_id)
     -- Un lien deja pose ne peut pas non plus etre efface.
     or (old.journal_entry_id is not null and new.journal_entry_id is null)
     or (old.cash_movement_id is not null and new.cash_movement_id is null)
  then
    raise exception
      'Encaissement % comptabilise — contenu financier immuable (correction par annulation et contre-passation)',
      old.payment_number;
  end if;

  return new;
end;
$$;

revoke execute on function app_private.customer_payments_immutable_once_recorded() from public;

-- =====================================================================
-- AUTO-VERIFICATION
-- =====================================================================
do $verify$
declare
  v_ok boolean;
begin
  select prosrc like '%old.journal_entry_id is not null%'
    into v_ok
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app_private'
     and p.proname = 'customer_payments_immutable_once_recorded';

  if v_ok is null then
    raise exception 'ECHEC : la fonction d''immutabilite des encaissements est introuvable.';
  end if;
  if not v_ok then
    raise exception 'ECHEC : le correctif n''a PAS ete applique (ancienne version toujours active).';
  end if;

  raise notice 'OK : correctif du rattachement comptable applique.';
end;
$verify$;
