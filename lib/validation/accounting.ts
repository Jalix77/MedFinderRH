import * as z from 'zod'

export const JournalSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, { error: 'Le code doit contenir au moins 2 caracteres.' })
    .toUpperCase(),
  label: z.string().trim().min(2, { error: 'Le libelle doit contenir au moins 2 caracteres.' }),
})

export const AccountingPeriodSchema = z.object({
  fiscal_year_id: z.string().uuid({ error: 'Exercice comptable requis.' }),
  month: z.coerce.number().int().min(1).max(12, { error: 'Mois invalide (1-12).' }),
})

const ManualEntryLineSchema = z
  .object({
    account_id: z.string().uuid({ error: 'Compte requis.' }),
    debit: z.coerce.number().min(0).default(0),
    credit: z.coerce.number().min(0).default(0),
  })
  .refine((l) => l.debit > 0 || l.credit > 0, { error: 'Chaque ligne doit porter un debit ou un credit.' })
  .refine((l) => !(l.debit > 0 && l.credit > 0), { error: 'Une ligne ne peut pas etre a la fois debit et credit.' })

export const ManualJournalEntrySchema = z.object({
  journal_code: z.string().trim().min(1, { error: 'Journal requis.' }),
  entry_date: z.string().trim().min(1, { error: 'Date requise.' }),
  description: z.string().trim().min(3, { error: 'Description requise (au moins 3 caracteres).' }),
  lines: z
    .array(ManualEntryLineSchema)
    .min(2, { error: 'Au moins 2 lignes sont requises pour une ecriture equilibree.' }),
})
