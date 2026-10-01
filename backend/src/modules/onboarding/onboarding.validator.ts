import { z } from 'zod';

function rejectDuplicateIds(message: string) {
  return (ids: string[], ctx: z.RefinementCtx): void => {
    const seen = new Set<string>();
    for (const id of ids) {
      const key = id.toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message
        });
        return;
      }
      seen.add(key);
    }
  };
}

function uuidList(options: {
  label: string;
  itemLabel: string;
  duplicateMessage: string;
  min: number;
  max?: number;
  minMessage: string;
  maxMessage?: string;
}) {
  let list = z
    .array(z.string().uuid(`Each ${options.itemLabel} must be a valid UUID.`), {
      invalid_type_error: `${options.label} must be an array.`,
      required_error: `${options.label} is required.`
    })
    .min(options.min, options.minMessage);

  if (options.max !== undefined && options.maxMessage) {
    list = list.max(options.max, options.maxMessage);
  }

  return list.superRefine(rejectDuplicateIds(options.duplicateMessage));
}

export const replaceInterestsSchema = z
  .object({
    interestIds: uuidList({
      label: 'Interest ids',
      itemLabel: 'interest id',
      duplicateMessage: 'Duplicate interest ids are not allowed.',
      min: 3,
      max: 10,
      minMessage: 'Select at least 3 interests.',
      maxMessage: 'Select at most 10 interests.'
    })
  })
  .strict();

function uuidListAllowEmpty(options: { label: string; itemLabel: string; duplicateMessage: string }) {
  return z
    .array(z.string().uuid(`Each ${options.itemLabel} must be a valid UUID.`), {
      invalid_type_error: `${options.label} must be an array.`,
      required_error: `${options.label} is required.`
    })
    .superRefine(rejectDuplicateIds(options.duplicateMessage));
}

export const replaceRelationshipIntentionsSchema = z
  .object({
    relationshipIntentionIds: uuidList({
      label: 'Relationship intention ids',
      itemLabel: 'relationship intention id',
      duplicateMessage: 'Duplicate relationship intention ids are not allowed.',
      min: 1,
      minMessage: 'Select at least 1 relationship intention.'
    })
  })
  .strict();

export const replaceDatingPreferencesSchema = z
  .object({
    minAge: z
      .number({
        invalid_type_error: 'Minimum age must be an integer.',
        required_error: 'Minimum age is required.'
      })
      .int('Minimum age must be an integer.')
      .min(18, 'Minimum age must be at least 18.'),
    maxAge: z
      .number({
        invalid_type_error: 'Maximum age must be an integer.',
        required_error: 'Maximum age is required.'
      })
      .int('Maximum age must be an integer.')
      .max(100, 'Maximum age must be at most 100.'),
    maxDistanceKm: z
      .number({
        invalid_type_error: 'Maximum distance must be an integer.',
        required_error: 'Maximum distance is required.'
      })
      .int('Maximum distance must be an integer.')
      .min(1, 'Maximum distance must be at least 1.')
      .max(500, 'Maximum distance must be at most 500.'),
    interestedInGenderIds: uuidListAllowEmpty({
      label: 'Interested-in gender ids',
      itemLabel: 'gender id',
      duplicateMessage: 'Duplicate gender ids are not allowed.'
    }),
    preferredIntentionIds: uuidListAllowEmpty({
      label: 'Preferred intention ids',
      itemLabel: 'relationship intention id',
      duplicateMessage: 'Duplicate relationship intention ids are not allowed.'
    })
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.maxAge < value.minAge) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maxAge'],
        message: 'Maximum age must be greater than or equal to minimum age.'
      });
    }
  });

const CITY_MAX = 100;

function coordinate(label: string, min: number, max: number) {
  return z
    .number({
      invalid_type_error: `${label} must be a number.`,
      required_error: `${label} is required.`
    })
    .finite(`${label} must be a finite number.`)
    .min(min, `${label} must be at least ${min}.`)
    .max(max, `${label} must be at most ${max}.`);
}

export const saveLocationSchema = z
  .object({
    city: z
      .string({
        invalid_type_error: 'City must be a string.',
        required_error: 'City is required.'
      })
      .trim()
      .min(1, 'City is required.')
      .max(CITY_MAX, `City must be at most ${CITY_MAX} characters.`),
    latitude: coordinate('Latitude', -90, 90),
    longitude: coordinate('Longitude', -180, 180)
  })
  .strict();

export type ReplaceInterestsBody = z.infer<typeof replaceInterestsSchema>;
export type ReplaceRelationshipIntentionsBody = z.infer<typeof replaceRelationshipIntentionsSchema>;
export type ReplaceDatingPreferencesBody = z.infer<typeof replaceDatingPreferencesSchema>;
export type SaveLocationBody = z.infer<typeof saveLocationSchema>;
