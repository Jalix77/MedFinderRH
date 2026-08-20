/**
 * Les RPC financieres (approve_expense_request, pay_expense_request, ...)
 * renvoient {"success": boolean, "error"?: string, ...} pour toute
 * denial d'autorisation ou de regle metier (convention Phase 1A/1C — voir
 * l'en-tete de supabase/migrations/20260813100009_admin_rpc_functions.sql :
 * une exception y aurait annule la trace d'audit "denied"). Les erreurs de
 * donnees invalides (ressource introuvable, montant negatif) restent des
 * exceptions Postgres classiques, deja portees par `error` cote
 * supabase-js. Ce helper centralise la traduction des deux formes en un
 * message francais clair, systematiquement leve comme une erreur classique
 * pour rester coherent avec le reste de l'application (app/actions/hr.ts) :
 * l'UI n'est jamais l'autorite, mais elle reste responsable d'afficher
 * fidelement pourquoi le backend a refuse.
 */

const ERROR_MESSAGES: Record<string, string> = {
  not_authorized: "Vous n'avez pas la permission necessaire pour cette action.",
  self_approval_blocked: 'Vous ne pouvez pas approuver votre propre demande.',
  self_validation_blocked: "Vous ne pouvez pas valider votre propre exception — un DIRECTEUR_GENERAL ou SUPER_ADMIN distinct est requis.",
  validator_must_be_dg: 'Seul un DIRECTEUR_GENERAL (ou SUPER_ADMIN) peut valider une exception de separation des fonctions.',
  no_pending_exception: 'Aucune exception en attente pour cette demande.',
  payer_is_approver: "Le payeur ne peut pas etre la meme personne que l'approbateur.",
  no_commitment_requires_budget_manage: "Un paiement sans engagement prealable exige la permission de gestion budgetaire.",
  invalid_status: "Cette action n'est pas possible dans l'etat actuel de la demande.",
  no_attachment: 'Au moins un justificatif doit etre deppose avant de comptabiliser.',
  entry_not_posted: "Cette ecriture n'est pas comptabilisee.",
  journal_not_found: 'Journal comptable introuvable pour cette organisation.',
  no_open_period: "Aucune periode comptable ouverte pour cette date — configurez d'abord l'exercice/periode correspondant.",

  // --- Facturation et encaissements (Phase 2C) -----------------------
  document_not_found: 'Document introuvable ou inaccessible.',
  invoice_not_found: 'Facture introuvable ou inaccessible.',
  payment_not_found: 'Encaissement introuvable ou inaccessible.',
  no_lines: 'Le document doit comporter au moins une ligne.',
  zero_total: 'Le total du document doit etre strictement positif.',
  self_issue_blocked:
    "Vous ne pouvez pas emettre un document que vous avez vous-meme cree — demandez une exception a un DIRECTEUR_GENERAL.",
  already_decided: 'Cette exception a deja fait l\'objet d\'une decision.',
  exception_not_found: 'Exception introuvable.',
  invalid_decision: 'Decision invalide.',
  justification_required: 'Une justification est obligatoire.',
  reason_required: 'Un motif est obligatoire.',
  not_authorized_reverse:
    "Annuler un document comptabilise est une contre-passation : la permission de contre-passation est requise en plus.",
  period_closed: 'La periode comptable correspondante est fermee — comptabilisation impossible.',
  no_accounting_period: "Aucune periode comptable ne couvre cette date — configurez l'exercice correspondant.",
  receivable_account_not_configured:
    "Aucun compte client n'est configure (ni sur le tiers, ni par defaut sur l'organisation).",
  tax_account_not_configured:
    "Une ligne est taxee mais aucun compte de taxe n'est configure sur le taux applique.",
  third_party_organization_mismatch: "Le tiers n'appartient pas a la meme organisation que le document.",
  invalid_exchange_rate: 'Le taux de change est incoherent avec la devise du document.',
  credited_invoice_required: 'Un avoir doit referencer la facture creditee.',
  credited_invoice_not_found: 'La facture creditee est introuvable.',
  credit_exceeds_invoice:
    "Le cumul des avoirs depasserait le total de la facture creditee.",
  not_an_invoice: "Seule une FACTURE peut etre encaissee — un avoir ne s'encaisse pas comme une facture.",
  invalid_amount: 'Le montant doit etre strictement positif.',
  invalid_treasury_account_type: 'Type de compte de tresorerie invalide.',
  treasury_account_not_found: 'Compte de tresorerie introuvable.',
  treasury_account_organization_mismatch:
    "Le compte de tresorerie n'appartient pas a la meme organisation que la facture.",
  currency_mismatch:
    "La devise du paiement doit etre celle de la facture (aucun paiement en devise croisee en Phase 2C).",
  overpayment: 'Le montant depasse le solde restant de la facture.',
}

export function rpcErrorMessage(code: string): string {
  return ERROR_MESSAGES[code] ?? `Action refusee (${code}).`
}

/**
 * Verifie le resultat {success, error} d'une RPC financiere et leve une
 * Error avec un message francais si success=false. A appeler juste apres
 * tout `supabase.rpc(...)` dont la convention de retour est {success,error}.
 */
export function assertRpcSuccess(data: unknown): asserts data is { success: true; [key: string]: unknown } {
  if (data && typeof data === 'object' && 'success' in data && (data as { success: unknown }).success === false) {
    const code = 'error' in data ? String((data as { error: unknown }).error) : 'unknown_error'
    throw new Error(rpcErrorMessage(code))
  }
}
