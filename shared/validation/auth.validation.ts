import { z } from 'zod';

export const LoginFormSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export type LoginFormData = z.infer<typeof LoginFormSchema>;

export const ForgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export type ForgotPassword = z.infer<typeof ForgotPasswordSchema>;

export const ResetPasswordSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  newPassword: z
    .string()
    .min(8, 'New password must be at least 8 characters')
    .regex(/[A-Z]/, 'New password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'New password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'New password must contain at least one number'),
});

export type ResetPassword = z.infer<typeof ResetPasswordSchema>;
