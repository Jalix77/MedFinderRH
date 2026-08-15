import * as z from 'zod'

export const ExpenseCategorySchema = z.object({
  name: z.string().trim().min(2, { error: 'Le nom doit contenir au moins 2 caracteres.' }),
  default_account_id: z.string().uuid().nullish(),
})

export const ExpenseRequestSchema = z.object({
  budget_line_id: z.string().uuid({ error: 'Ligne budgetaire requise.' }),
  category_id: z.string().uuid().nullish(),
  cost_center_id: z.string().uuid().nullish(),
  payee_name: z.string().trim().min(2, { error: 'Nom du beneficiaire requis (2 caracteres minimum).' }),
  payee_reference: z.string().trim().nullish(),
  description: z.string().trim().nullish(),
  amount: z.coerce.number().positive({ error: 'Le montant doit etre superieur a zero.' }),
  currency: z.enum(['HTG', 'USD']).default('HTG'),
  payment_method: z.enum(['cash', 'bank', 'mobile_money'], { error: 'Mode de paiement requis.' }),
  requested_date: z.iso.date().optional(),
})

export const ExpenseDecisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  comment: z.string().trim().nullish(),
})

export const ExpensePaymentSchema = z.object({
  treasury_account_type: z.enum(['cash', 'bank', 'mobile_money']),
  treasury_account_id: z.string().uuid({ error: 'Compte de tresorerie requis.' }),
  paid_date: z.iso.date().nullish(),
  no_commitment_reason: z.string().trim().nullish(),
})

export const ExpenseCancelSchema = z.object({
  reason: z.string().trim().min(5, { error: 'Une justification est obligatoire (5 caracteres minimum).' }),
})

export const ExpenseExceptionRequestSchema = z.object({
  justification: z.string().trim().min(5, { error: 'Une justification est obligatoire (5 caracteres minimum).' }),
})

export const ExpenseExceptionValidationSchema = z.object({
  result: z.enum(['approved', 'refused']),
  comment: z.string().trim().nullish(),
})
