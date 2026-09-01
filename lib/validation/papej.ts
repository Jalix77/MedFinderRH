import * as z from 'zod'

/**
 * Un « financement » est une ENTREE DE FONDS adossee a une contrepartie
 * comptable choisie. Le type distingue la nature de cette contrepartie :
 * une subvention se credite en PRODUIT, un emprunt en PASSIF, un solde
 * d'ouverture en CAPITAUX PROPRES. Le mecanisme d'encaissement
 * (record_grant_funds_received) est identique dans les trois cas — il
 * cree le mouvement de tresorerie, met a jour le solde du compte et
 * comptabilise une ecriture equilibree.
 */
export const GrantSchema = z.object({
  type: z.enum(['PAPEJ', 'SUBVENTION', 'EMPRUNT', 'SOLDE_OUVERTURE', 'AUTRE']).default('PAPEJ'),
  name: z.string().trim().min(2, { error: 'Le nom doit contenir au moins 2 caracteres.' }),
  donor_name: z.string().trim().nullish(),
  amount_granted: z.coerce.number().min(0, { error: 'Le montant accorde ne peut pas etre negatif.' }),
  currency: z.enum(['HTG', 'USD']).default('HTG'),
  revenue_account_id: z.string().uuid({ error: 'Compte comptable credite requis (necessaire pour enregistrer une reception).' }),
})

export const GrantBudgetLineSchema = z.object({
  category: z.string().trim().min(2, { error: 'La categorie doit contenir au moins 2 caracteres.' }),
  planned_amount: z.coerce.number().min(0, { error: 'Le montant planifie ne peut pas etre negatif.' }),
  notes: z.string().trim().nullish(),
})

export const GrantReceiptSchema = z.object({
  amount: z.coerce.number().positive({ error: 'Le montant recu doit etre superieur a zero.' }),
  received_date: z.iso.date({ error: 'Date de reception invalide.' }),
  treasury_account_type: z.enum(['cash', 'bank', 'mobile_money']),
  treasury_account_id: z.string().uuid({ error: 'Compte de tresorerie requis.' }),
})

export const PapejReportSchema = z
  .object({
    period_start: z.iso.date({ error: 'Date de debut invalide.' }),
    period_end: z.iso.date({ error: 'Date de fin invalide.' }),
  })
  .refine((data) => data.period_end >= data.period_start, {
    error: 'La date de fin doit etre posterieure ou egale a la date de debut.',
    path: ['period_end'],
  })
