import * as z from 'zod'

const CURRENCY = z.enum(['HTG', 'USD']).default('HTG')

export const CashAccountSchema = z.object({
  name: z.string().trim().min(2, { error: 'Le nom doit contenir au moins 2 caracteres.' }),
  gl_account_id: z.string().uuid({ error: 'Compte comptable requis.' }),
  currency: CURRENCY,
})

export const BankAccountSchema = z.object({
  bank_name: z.string().trim().min(2, { error: 'Le nom de la banque doit contenir au moins 2 caracteres.' }),
  account_number_masked: z.string().trim().nullish(),
  gl_account_id: z.string().uuid({ error: 'Compte comptable requis.' }),
  currency: CURRENCY,
})

export const MobileMoneyAccountSchema = z.object({
  provider: z.string().trim().min(2, { error: 'Fournisseur requis (ex. MonCash, NatCash).' }),
  account_number_masked: z.string().trim().nullish(),
  gl_account_id: z.string().uuid({ error: 'Compte comptable requis.' }),
  currency: CURRENCY,
})
