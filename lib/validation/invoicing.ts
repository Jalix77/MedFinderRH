import { z } from 'zod'

/**
 * Schemas de validation Phase 2C.4 (couche UI).
 *
 * Rappel de securite : cette validation est une COMMODITE — elle donne un
 * message clair a l'utilisateur avant l'aller-retour reseau. L'autorite
 * reste la base (contraintes, triggers, RLS) et les RPC metier, qui
 * revalident tout. Aucune regle metier n'est dupliquee ici : on ne
 * verifie que la forme des donnees saisies.
 */

const uuid = z.string().uuid('Identifiant invalide.')
const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v))
  .nullable()

export const ThirdPartySchema = z.object({
  legal_name: z.string().trim().min(1, 'La raison sociale est obligatoire.'),
  commercial_name: optionalText,
  legal_form: optionalText,
  tax_id: optionalText,
  is_customer: z.boolean(),
  is_supplier: z.boolean(),
  email: optionalText,
  phone: optionalText,
  preferred_currency: z.enum(['HTG', 'USD']),
  payment_terms_days: z.coerce.number().int().min(0, "Le delai de paiement ne peut pas etre negatif."),
  notes: optionalText,
}).refine((v) => v.is_customer || v.is_supplier, {
  message: 'Un tiers doit etre client, fournisseur, ou les deux.',
  path: ['is_customer'],
})

export const InvoiceLineSchema = z.object({
  description: z.string().trim().min(1, 'La description de la ligne est obligatoire.'),
  quantity: z.coerce.number().positive('La quantite doit etre strictement positive.'),
  unit_price: z.coerce.number().min(0, 'Le prix unitaire ne peut pas etre negatif.'),
  revenue_account_id: uuid,
  tax_rate_id: z.string().uuid().nullable().optional(),
})

export const InvoiceDraftSchema = z.object({
  document_type: z.enum(['INVOICE', 'CREDIT_NOTE']),
  third_party_id: uuid,
  credited_invoice_id: z.string().uuid().nullable().optional(),
  credit_reason: optionalText,
  document_date: z.string().min(1, 'La date du document est obligatoire.'),
  due_date: z.string().min(1, "L'echeance est obligatoire."),
  currency: z.enum(['HTG', 'USD']),
  exchange_rate_to_htg: z.coerce.number().positive('Le taux doit etre strictement positif.'),
  external_reference: optionalText,
  notes: optionalText,
  cost_center_id: z.string().uuid().nullable().optional(),
  lines: z.array(InvoiceLineSchema).min(1, 'Au moins une ligne est requise.'),
})
  .refine((v) => v.due_date >= v.document_date, {
    message: "L'echeance ne peut pas preceder la date du document.",
    path: ['due_date'],
  })
  .refine((v) => v.currency !== 'HTG' || v.exchange_rate_to_htg === 1, {
    message: 'En HTG, le taux de change vers HTG est necessairement 1.',
    path: ['exchange_rate_to_htg'],
  })
  .refine((v) => v.document_type !== 'CREDIT_NOTE' || (v.credit_reason ?? '') !== '', {
    message: 'Un avoir exige un motif.',
    path: ['credit_reason'],
  })
  .refine((v) => v.document_type !== 'CREDIT_NOTE' || !!v.credited_invoice_id, {
    message: 'Un avoir doit referencer la facture creditee.',
    path: ['credited_invoice_id'],
  })

export type InvoiceDraftInput = z.infer<typeof InvoiceDraftSchema>
