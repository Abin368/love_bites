import { z } from 'zod';
import { isAtLeast18, isRealCalendarDate } from '../auth/auth.validator';

const FIRST_NAME_MAX = 100;
const BIO_MAX = 500;
const SHORT_TEXT_MAX = 100;

const dateOfBirthSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must use YYYY-MM-DD.')
  .refine(isRealCalendarDate, 'Date of birth must be a real calendar date.');

const firstNameSchema = z
  .string()
  .trim()
  .min(1, 'First name is required.')
  .max(FIRST_NAME_MAX, `First name must be at most ${FIRST_NAME_MAX} characters.`);

function optionalText(max: number, label: string) {
  return z
    .union([
      z
        .string()
        .trim()
        .max(max, `${label} must be at most ${max} characters.`)
        .transform((value) => (value.length === 0 ? null : value)),
      z.null()
    ])
    .optional();
}

function rejectUnderage(value: { dateOfBirth?: string }, ctx: z.RefinementCtx): void {
  if (value.dateOfBirth && isRealCalendarDate(value.dateOfBirth) && !isAtLeast18(value.dateOfBirth)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['dateOfBirth'],
      message: 'You must be at least 18 years old.',
      params: { errorCode: 'UNDERAGE_NOT_PERMITTED' }
    });
  }
}

const profileFields = {
  firstName: firstNameSchema,
  dateOfBirth: dateOfBirthSchema,
  genderId: z.string().uuid('Gender must be a valid UUID.'),
  bio: optionalText(BIO_MAX, 'Bio'),
  occupation: optionalText(SHORT_TEXT_MAX, 'Occupation'),
  education: optionalText(SHORT_TEXT_MAX, 'Education')
};

export const createProfileSchema = z
  .object({
    firstName: profileFields.firstName,
    dateOfBirth: profileFields.dateOfBirth,
    genderId: profileFields.genderId,
    bio: profileFields.bio,
    occupation: profileFields.occupation,
    education: profileFields.education
  })
  .strict()
  .superRefine(rejectUnderage);

export const updateProfileSchema = z
  .object({
    firstName: profileFields.firstName.optional(),
    dateOfBirth: profileFields.dateOfBirth.optional(),
    genderId: profileFields.genderId.optional(),
    bio: profileFields.bio,
    occupation: profileFields.occupation,
    education: profileFields.education
  })
  .strict()
  .superRefine((value, ctx) => {
    rejectUnderage(value, ctx);
    if (Object.keys(value).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one profile field is required.'
      });
    }
  });

export type CreateProfileBody = z.infer<typeof createProfileSchema>;
export type UpdateProfileBody = z.infer<typeof updateProfileSchema>;
