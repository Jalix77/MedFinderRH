-- MedFinder Gestion — Phase 2C, jalon 2C.2 (2e migration) : RPC de
-- workflow documentaire. Conventions identiques a celles de la Phase 2A
-- (approve_manual_journal_entry) : security definer, search_path fixe,
-- revoke public + grant authenticated, refus renvoye en
-- {success:false, error:'...'} plutot qu'en exception — afin de
-- preserver la trace d'audit "denied" etablie depuis la Phase 1A.
--
-- ============================================================
-- AUCUNE COMPTABILISATION DANS CE JALON
-- ============================================================
-- issue_invoice_document attribue le numero, fige le taux et bascule le
-- statut. Elle NE genere AUCUNE ecriture comptable et AUCUN mouvement de
-- tresorerie : c'est le jalon 2C.3 qui ajoutera la comptabilisation
-- DANS CETTE MEME FONCTION, en une seule transaction avec l'emission
-- (decision arbitree n°9). La fonction est donc concue des maintenant
-- comme le point d'insertion unique de cette future comptabilisation.

-- =====================================================================
-- 1. Soumission : brouillon -> pret a emettre
-- =====================================================================

create or replace function public.submit_invoice_document(p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_doc public.invoices%rowtype;
  v_line_count int;
begin
  select * into v_doc from public.invoices where id = p_document_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'document_not_found');
  end if;

  if not (app_private.is_super_admin(v_actor)
          or app_private.has_permission(v_actor, v_doc.organization_id, 'invoice.manage')) then
    perform app_private.write_audit_log(
      v_doc.organization_id, 'submit_invoice_document', 'ventes', 'invoice', p_document_id,
      null, null, 'denied'
    );
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  if v_doc.status <> 'draft' then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;

  select count(*) into v_line_count from public.invoice_lines where invoice_id = p_document_id;
  if v_line_count = 0 then
    return jsonb_build_object('success', false, 'error', 'no_lines');
  end if;

  update public.invoices set status = 'pending_issue', updated_by = v_actor where id = p_document_id;

  perform app_private.write_audit_log(
    v_doc.organization_id, 'submit_invoice_document', 'ventes', 'invoice', p_document_id,
    null, jsonb_build_object('document_type', v_doc.document_type), 'success'
  );

  return jsonb_build_object('success', true, 'status', 'pending_issue');
end;
$$;

revoke all on function public.submit_invoice_document(uuid) from public;
grant execute on function public.submit_invoice_document(uuid) to authenticated;

-- =====================================================================
-- 2. Emission — numero, gel du taux, statut. AUCUNE ECRITURE (2C.3).
-- =====================================================================
-- Decision arbitree n°2 : separation des fonctions. L'emetteur ne peut
-- pas etre le createur du document, sauf exception formellement validee
-- par un DIRECTEUR_GENERAL ou un SUPER_ADMIN (section 4). Meme
-- mecanisme exact qu'en Phase 2A : une garde d'ACTEUR, pas une
-- permission distincte.

create or replace function public.issue_invoice_document(p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_doc public.invoices%rowtype;
  v_line_count int;
  v_total numeric(14, 2);
  v_number text;
  v_entity_type text;
  v_exception_ok boolean;
begin
  select * into v_doc from public.invoices where id = p_document_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'document_not_found');
  end if;

  if not (app_private.is_super_admin(v_actor)
          or app_private.has_permission(v_actor, v_doc.organization_id, 'invoice.manage')) then
    perform app_private.write_audit_log(
      v_doc.organization_id, 'issue_invoice_document', 'ventes', 'invoice', p_document_id,
      null, null, 'denied'
    );
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  if v_doc.status not in ('draft', 'pending_issue') then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;

  -- Separation des fonctions : blocage strict, sauf exception validee.
  if v_doc.created_by = v_actor and not app_private.is_super_admin(v_actor) then
    select exists (
      select 1 from public.invoice_issue_approvals a
      where a.invoice_id = p_document_id
        and a.exception_result = 'approved'
        and a.exception_requested_by = v_actor
    ) into v_exception_ok;

    if not coalesce(v_exception_ok, false) then
      perform app_private.write_audit_log(
        v_doc.organization_id, 'issue_invoice_document', 'ventes', 'invoice', p_document_id,
        null, jsonb_build_object('reason', 'self_issue_blocked'), 'denied'
      );
      return jsonb_build_object('success', false, 'error', 'self_issue_blocked');
    end if;
  end if;

  select count(*), coalesce(sum(line_total), 0)
    into v_line_count, v_total
    from public.invoice_lines where invoice_id = p_document_id;

  if v_line_count = 0 then
    return jsonb_build_object('success', false, 'error', 'no_lines');
  end if;
  if v_total <= 0 then
    return jsonb_build_object('success', false, 'error', 'zero_total');
  end if;

  -- Numerotation : sequence DISTINCTE selon le type de document
  -- (decision arbitree n°3), via le moteur existant — aucun second
  -- mecanisme de sequence.
  v_entity_type := case when v_doc.document_type = 'CREDIT_NOTE'
                        then 'credit_note' else 'customer_invoice' end;
  v_number := app_private.next_number_internal(v_doc.organization_id, v_entity_type);

  -- NOTE JALON 2C.3 : la comptabilisation (Dr Creances / Cr Produits
  -- + taxe) viendra s'inserer ICI, dans la meme transaction que la mise
  -- a jour ci-dessous, de sorte qu'aucun etat "emis sans ecriture" ne
  -- soit jamais observable.

  update public.invoices
     set document_number = v_number,
         status          = 'issued',
         issued_at       = now(),
         issued_by       = v_actor,
         updated_by      = v_actor
   where id = p_document_id;

  perform app_private.write_audit_log(
    v_doc.organization_id, 'issue_invoice_document', 'ventes', 'invoice', p_document_id,
    null,
    jsonb_build_object('document_type', v_doc.document_type, 'document_number', v_number, 'total', v_total),
    'success'
  );

  return jsonb_build_object(
    'success', true, 'document_number', v_number, 'status', 'issued', 'total', v_total
  );
end;
$$;

revoke all on function public.issue_invoice_document(uuid) from public;
grant execute on function public.issue_invoice_document(uuid) to authenticated;

-- =====================================================================
-- 3. Annulation motivee d'un document emis
-- =====================================================================
-- A ce jalon, aucun encaissement n'existe : la garde "refus si deja
-- paye" sera ajoutee au jalon 2C.4, en meme temps que amount_paid.
-- Aucune contre-passation n'est effectuee ici puisque aucune ecriture
-- n'a ete generee (2C.3).

create or replace function public.cancel_invoice_document(p_document_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_doc public.invoices%rowtype;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    return jsonb_build_object('success', false, 'error', 'reason_required');
  end if;

  select * into v_doc from public.invoices where id = p_document_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'document_not_found');
  end if;

  if not (app_private.is_super_admin(v_actor)
          or app_private.has_permission(v_actor, v_doc.organization_id, 'invoice.manage')) then
    perform app_private.write_audit_log(
      v_doc.organization_id, 'cancel_invoice_document', 'ventes', 'invoice', p_document_id,
      null, null, 'denied'
    );
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  if v_doc.status <> 'issued' then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;

  update public.invoices
     set status        = 'cancelled',
         cancel_reason = p_reason,
         cancelled_at  = now(),
         cancelled_by  = v_actor,
         updated_by    = v_actor
   where id = p_document_id;

  perform app_private.write_audit_log(
    v_doc.organization_id, 'cancel_invoice_document', 'ventes', 'invoice', p_document_id,
    null, jsonb_build_object('reason', p_reason), 'success'
  );

  return jsonb_build_object('success', true, 'status', 'cancelled');
end;
$$;

revoke all on function public.cancel_invoice_document(uuid, text) from public;
grant execute on function public.cancel_invoice_document(uuid, text) to authenticated;

-- =====================================================================
-- 4. Exception formelle a la separation des fonctions
--    (miroir exact du mecanisme des depenses 1C.4 et des ecritures 2A)
-- =====================================================================

create or replace function public.request_invoice_issue_exception(
  p_document_id uuid, p_justification text
) returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_doc public.invoices%rowtype;
  v_id uuid;
begin
  if p_justification is null or length(trim(p_justification)) = 0 then
    return jsonb_build_object('success', false, 'error', 'justification_required');
  end if;

  select * into v_doc from public.invoices where id = p_document_id;
  if not found then
    return jsonb_build_object('success', false, 'error', 'document_not_found');
  end if;

  if not (app_private.is_super_admin(v_actor)
          or app_private.has_permission(v_actor, v_doc.organization_id, 'invoice.manage')) then
    perform app_private.write_audit_log(
      v_doc.organization_id, 'request_invoice_issue_exception', 'ventes', 'invoice', p_document_id,
      null, null, 'denied'
    );
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  if v_doc.status not in ('draft', 'pending_issue') then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;

  insert into public.invoice_issue_approvals (
    organization_id, invoice_id, exception_justification, exception_requested_by
  ) values (
    v_doc.organization_id, p_document_id, p_justification, v_actor
  ) returning id into v_id;

  perform app_private.write_audit_log(
    v_doc.organization_id, 'request_invoice_issue_exception', 'ventes', 'invoice', p_document_id,
    null, jsonb_build_object('justification', p_justification), 'success'
  );

  return jsonb_build_object('success', true, 'exception_id', v_id);
end;
$$;

revoke all on function public.request_invoice_issue_exception(uuid, text) from public;
grant execute on function public.request_invoice_issue_exception(uuid, text) to authenticated;

create or replace function public.validate_invoice_issue_exception(
  p_exception_id uuid, p_decision text, p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_exc public.invoice_issue_approvals%rowtype;
begin
  if p_decision not in ('approved', 'refused') then
    return jsonb_build_object('success', false, 'error', 'invalid_decision');
  end if;

  select * into v_exc from public.invoice_issue_approvals where id = p_exception_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'exception_not_found');
  end if;

  -- Seul un DIRECTEUR_GENERAL ou un SUPER_ADMIN peut valider une
  -- exception a la separation des fonctions.
  if not (app_private.is_super_admin(v_actor)
          or app_private.has_role(v_actor, v_exc.organization_id, 'DIRECTEUR_GENERAL')) then
    perform app_private.write_audit_log(
      v_exc.organization_id, 'validate_invoice_issue_exception', 'ventes', 'invoice', v_exc.invoice_id,
      null, jsonb_build_object('reason', 'validator_not_authorized'), 'denied'
    );
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  -- Le demandeur ne valide jamais sa propre exception, meme SUPER_ADMIN.
  if v_exc.exception_requested_by = v_actor then
    perform app_private.write_audit_log(
      v_exc.organization_id, 'validate_invoice_issue_exception', 'ventes', 'invoice', v_exc.invoice_id,
      null, jsonb_build_object('reason', 'self_validation_blocked'), 'denied'
    );
    return jsonb_build_object('success', false, 'error', 'self_validation_blocked');
  end if;

  if v_exc.exception_result is not null then
    return jsonb_build_object('success', false, 'error', 'already_decided');
  end if;

  update public.invoice_issue_approvals
     set exception_result       = p_decision,
         exception_validated_by = v_actor,
         exception_validated_at = now(),
         decision_reason        = p_reason
   where id = p_exception_id;

  perform app_private.write_audit_log(
    v_exc.organization_id, 'validate_invoice_issue_exception', 'ventes', 'invoice', v_exc.invoice_id,
    null, jsonb_build_object('decision', p_decision), 'success'
  );

  return jsonb_build_object('success', true, 'decision', p_decision);
end;
$$;

revoke all on function public.validate_invoice_issue_exception(uuid, text, text) from public;
grant execute on function public.validate_invoice_issue_exception(uuid, text, text) to authenticated;
