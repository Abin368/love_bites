import { z } from 'zod';
import { PHOTO_MIME_TYPES } from './profile-photos.types';

const MAX_FILE_SIZE_BYTES = 10_485_760;
const MAX_FILENAME_LENGTH = 255;

export const uploadUrlSchema = z
  .object({
    mimeType: z.enum(PHOTO_MIME_TYPES, {
      errorMap: () => ({ message: 'Mime type must be image/jpeg, image/png, or image/webp.' })
    }),
    fileSizeBytes: z
      .number({ invalid_type_error: 'File size must be a number of bytes.' })
      .int('File size must be a whole number of bytes.')
      .min(1, 'File size must be at least 1 byte.')
      .max(MAX_FILE_SIZE_BYTES, 'File size must be at most 10485760 bytes.'),
    originalFilename: z
      .string()
      .trim()
      .min(1, 'Original filename cannot be empty.')
      .max(MAX_FILENAME_LENGTH, 'Original filename must be at most 255 characters.')
      .optional()
  })
  .strict();

export const confirmPhotoSchema = z
  .object({
    photoId: z.string().uuid('Photo id must be a valid UUID.'),
    storageKey: z.string().min(1, 'Storage key is required.').max(512, 'Storage key is too long.'),
    displayOrder: z
      .number({ invalid_type_error: 'Display order must be a number.' })
      .int('Display order must be a whole number.')
      .min(1, 'Display order must be from 1 to 5.')
      .max(5, 'Display order must be from 1 to 5.'),
    isPrimary: z.boolean({ invalid_type_error: 'Primary flag must be true or false.' })
  })
  .strict();

export const updatePhotoSchema = z
  .object({
    displayOrder: z
      .number({ invalid_type_error: 'Display order must be a number.' })
      .int('Display order must be a whole number.')
      .min(1, 'Display order must be from 1 to 5.')
      .max(5, 'Display order must be from 1 to 5.')
      .optional(),
    isPrimary: z.boolean({ invalid_type_error: 'Primary flag must be true or false.' }).optional()
  })
  .strict()
  .refine((value) => value.displayOrder !== undefined || value.isPrimary !== undefined, {
    message: 'At least one photo field is required.'
  });

export const photoIdSchema = z.string().uuid('Photo id must be a valid UUID.');

export type UploadUrlBody = z.infer<typeof uploadUrlSchema>;
export type ConfirmPhotoBody = z.infer<typeof confirmPhotoSchema>;
export type UpdatePhotoBody = z.infer<typeof updatePhotoSchema>;
