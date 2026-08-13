import * as z from 'zod'

export const LoginSchema = z.object({
  email: z.email({ error: 'Adresse email invalide.' }).trim(),
  password: z.string().min(1, { error: 'Mot de passe requis.' }),
})

export type LoginFormState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'mfa_required' }

export const RequestPasswordResetSchema = z.object({
  email: z.email({ error: 'Adresse email invalide.' }).trim(),
})

export type RequestPasswordResetState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'sent' }

// Alignee sur supabase/config.toml [auth] : longueur >= 10,
// lower_upper_letters_digits.
export const UpdatePasswordSchema = z
  .object({
    password: z
      .string()
      .min(10, { error: 'Le mot de passe doit contenir au moins 10 caracteres.' })
      .regex(/[a-z]/, { error: 'Doit contenir au moins une minuscule.' })
      .regex(/[A-Z]/, { error: 'Doit contenir au moins une majuscule.' })
      .regex(/[0-9]/, { error: 'Doit contenir au moins un chiffre.' }),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    error: 'Les deux mots de passe ne correspondent pas.',
    path: ['confirmPassword'],
  })

export type UpdatePasswordState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success' }
