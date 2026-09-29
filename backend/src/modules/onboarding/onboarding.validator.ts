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

export type ReplaceInterestsBody = z.infer<typeof replaceInterestsSchema>;
export type ReplaceRelationshipIntentionsBody = z.infer<typeof replaceRelationshipIntentionsSchema>;
