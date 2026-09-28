import { z } from 'zod';

const EMAIL_PATTERN_MESSAGE = 'Email must be a valid email address.';
const PHONE_PATTERN = /^\+[1-9]\d{1,14}$/;

export function isRealCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isAtLeast18(dateOfBirth: string, now: Date = new Date()): boolean {
  if (!isRealCalendarDate(dateOfBirth)) {
    return false;
  }
  const [yearText, monthText, dayText] = dateOfBirth.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let age = today.getUTCFullYear() - year;
  const monthDiff = today.getUTCMonth() - (month - 1);
  if (monthDiff < 0 || (monthDiff === 0 && today.getUTCDate() < day)) {
    age -= 1;
  }
  return age >= 18;
}

function emptyToUndefined(value: unknown): unknown {
  if (typeof value === 'string' && value.trim() === '') {
    return undefined;
  }
  return value;
}

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(128, 'Password must be at most 128 characters.')
  .refine((value) => /[A-Z]/.test(value), 'Password must include an uppercase letter.')
  .refine((value) => /\d/.test(value), 'Password must include a digit.')
  .refine((value) => /[^A-Za-z0-9]/.test(value), 'Password must include a special character.');

export const registerSchema = z
  .object({
    email: z.preprocess(
      emptyToUndefined,
      z.string().trim().toLowerCase().email(EMAIL_PATTERN_MESSAGE).optional()
    ),
    phone: z.preprocess(
      emptyToUndefined,
      z.string().trim().regex(PHONE_PATTERN, 'Phone must be a valid E.164 number.').optional()
    ),
    password: passwordSchema,
    dateOfBirth: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must use YYYY-MM-DD.')
      .refine(isRealCalendarDate, 'Date of birth must be a real calendar date.'),
    termsAccepted: z.literal(true, {
      errorMap: () => ({ message: 'Terms of service must be accepted.' })
    }),
    privacyAccepted: z.literal(true, {
      errorMap: () => ({ message: 'Privacy policy must be accepted.' })
    })
  })
  .superRefine((value, ctx) => {
    if (!value.email && !value.phone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['email'],
        message: 'Email or phone is required.'
      });
    }
    if (isRealCalendarDate(value.dateOfBirth) && !isAtLeast18(value.dateOfBirth)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dateOfBirth'],
        message: 'You must be at least 18 years old.',
        params: { errorCode: 'UNDERAGE_NOT_PERMITTED' }
      });
    }
  });

export const identifierSchema = z.string().trim().min(1, 'Identifier is required.').transform((value, ctx) => {
  if (value.includes('@')) {
    const email = value.toLowerCase();
    const parsed = z.string().email().safeParse(email);
    if (!parsed.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Identifier must be a valid email or E.164 phone number.'
      });
      return z.NEVER;
    }
    return { type: 'email' as const, value: email };
  }

  if (!PHONE_PATTERN.test(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Identifier must be a valid email or E.164 phone number.'
    });
    return z.NEVER;
  }

  return { type: 'phone' as const, value };
});

export const verifyEmailSchema = z.object({
  email: z.string().trim().toLowerCase().email(EMAIL_PATTERN_MESSAGE),
  token: z.string().regex(/^\d{6}$/, 'Verification code must be 6 digits.')
});

export const verifyPhoneSchema = z.object({
  phone: z.string().trim().regex(PHONE_PATTERN, 'Phone must be a valid E.164 number.'),
  otp: z.string().regex(/^\d{6}$/, 'Verification code must be 6 digits.')
});

export const resendVerificationSchema = z
  .object({
    identifier: z.string().trim().min(1),
    type: z.enum(['EMAIL', 'PHONE'])
  })
  .superRefine((value, ctx) => {
    if (value.type === 'EMAIL' && !z.string().email().safeParse(value.identifier.toLowerCase()).success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['identifier'],
        message: 'A valid email is required for email verification.'
      });
    }
    if (value.type === 'PHONE' && !PHONE_PATTERN.test(value.identifier.trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['identifier'],
        message: 'A valid E.164 phone number is required for phone verification.'
      });
    }
  })
  .transform((value) => ({
    type: value.type,
    identifier: value.type === 'EMAIL' ? value.identifier.trim().toLowerCase() : value.identifier.trim()
  }));

export const loginSchema = z.object({
  identifier: identifierSchema,
  password: z.string().min(1, 'Password is required.').max(128)
});

export const forgotPasswordSchema = z.object({
  identifier: identifierSchema
});

export const resetPasswordSchema = z.object({
  identifier: identifierSchema,
  token: z.string().trim().min(1).max(512),
  newPassword: passwordSchema
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type VerifyPhoneInput = z.infer<typeof verifyPhoneSchema>;
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type NormalizedIdentifier = z.infer<typeof identifierSchema>;
