import * as z from 'zod'

export const FiscalYearSchema = z
  .object({
    label: z.string().trim().min(2, { error: "Le libelle doit contenir au moins 2 caracteres." }),
    start_date: z.iso.date({ error: 'Date de debut invalide.' }),
    end_date: z.iso.date({ error: 'Date de fin invalide.' }),
  })
  .refine((data) => data.end_date > data.start_date, {
    error: "La date de fin doit etre posterieure a la date de debut.",
    path: ['end_date'],
  })

export const BudgetSchema = z.object({
  fiscal_year_id: z.string().uuid({ error: 'Exercice comptable requis.' }),
  name: z.string().trim().min(2, { error: 'Le nom doit contenir au moins 2 caracteres.' }),
})

export const CostCenterSchema = z.object({
  code: z.string().trim().min(1, { error: 'Code requis.' }),
  name: z.string().trim().min(2, { error: 'Le nom doit contenir au moins 2 caracteres.' }),
  department_id: z.string().uuid().nullish(),
})

export const BudgetLineSchema = z.object({
  budget_id: z.string().uuid({ error: 'Budget requis.' }),
  category: z.string().trim().min(2, { error: 'La categorie doit contenir au moins 2 caracteres.' }),
  planned_amount: z.coerce.number().min(0, { error: 'Le montant planifie ne peut pas etre negatif.' }),
  currency: z.enum(['HTG', 'USD']).default('HTG'),
  cost_center_id: z.string().uuid().nullish(),
})

export const BudgetTransferSchema = z
  .object({
    from_line_id: z.string().uuid({ error: 'Ligne source requise.' }),
    to_line_id: z.string().uuid({ error: 'Ligne cible requise.' }),
    amount: z.coerce.number().positive({ error: 'Le montant doit etre superieur a zero.' }),
    reason: z.string().trim().min(5, { error: 'Une justification est obligatoire (5 caracteres minimum).' }),
  })
  .refine((data) => data.from_line_id !== data.to_line_id, {
    error: 'Les lignes source et cible doivent etre differentes.',
    path: ['to_line_id'],
  })
