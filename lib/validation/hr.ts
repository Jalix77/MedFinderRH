import * as z from 'zod'

export const DepartmentSchema = z.object({
  name: z.string().trim().min(2, { error: 'Le nom doit contenir au moins 2 caracteres.' }),
  parent_department_id: z.string().uuid().nullish(),
})

export const PositionSchema = z.object({
  title: z.string().trim().min(2, { error: 'Le titre doit contenir au moins 2 caracteres.' }),
  department_id: z.string().uuid().nullish(),
  description: z.string().trim().nullish(),
  responsibilities: z.string().trim().nullish(),
  required_skills: z.string().trim().nullish(),
  reports_to_position_id: z.string().uuid().nullish(),
})

export const EmployeeCreateSchema = z.object({
  first_name: z.string().trim().min(1, { error: 'Prenom requis.' }),
  last_name: z.string().trim().min(1, { error: 'Nom requis.' }),
  gender: z.enum(['F', 'M', 'autre', 'non_precise']).nullish(),
  hire_date: z.iso.date({ error: 'Date d\'embauche invalide.' }),
  department_id: z.string().uuid().nullish(),
  position_id: z.string().uuid().nullish(),
  manager_employee_id: z.string().uuid().nullish(),
})

export const EmployeeUpdateSchema = EmployeeCreateSchema.partial().extend({
  status: z.enum(['active', 'on_leave', 'terminated']).optional(),
})

// Champs "tres sensibles" (§80) — formulaire distinct, permission distincte.
export const EmployeeSensitiveDataSchema = z.object({
  birth_date: z.iso.date().nullish(),
  personal_phone: z.string().trim().nullish(),
  personal_email: z.email().nullish().or(z.literal('')),
  address: z.string().trim().nullish(),
  nif: z.string().trim().nullish(),
  ninu: z.string().trim().nullish(),
  cin: z.string().trim().nullish(),
  emergency_contact_name: z.string().trim().nullish(),
  emergency_contact_phone: z.string().trim().nullish(),
  hr_notes: z.string().trim().nullish(),
})

export const ContractSchema = z
  .object({
    type: z.enum(['CDI', 'CDD', 'consultant', 'prestataire', 'temps_partiel', 'fondateur', 'stage']),
    start_date: z.iso.date({ error: 'Date de debut invalide.' }),
    end_date: z.iso.date().nullish().or(z.literal('')),
    probation_end_date: z.iso.date().nullish().or(z.literal('')),
    base_salary: z.coerce.number().min(0, { error: 'Le salaire ne peut pas etre negatif.' }).nullish(),
    currency: z.enum(['HTG', 'USD']).default('HTG'),
    payment_method: z.enum(['virement_bancaire', 'moncash', 'especes', 'cheque']).nullish(),
  })
  .refine((data) => !data.end_date || data.end_date >= data.start_date, {
    error: 'La date de fin doit etre posterieure a la date de debut.',
    path: ['end_date'],
  })

export const ContractAmendmentSchema = z.object({
  effective_date: z.iso.date({ error: 'Date d\'effet invalide.' }),
  change_description: z.string().trim().min(5, { error: 'Description requise (5 caracteres minimum).' }),
})
