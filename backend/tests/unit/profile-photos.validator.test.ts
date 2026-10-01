import { confirmPhotoSchema, updatePhotoSchema, uploadUrlSchema } from '../../src/modules/profile-photos/profile-photos.validator';

const photoId = '9a12c4b5-8821-4122-901b-5e4d29381001';

describe('profile photo validation', () => {
  it('accepts jpeg, png, and webp uploads and trims the filename', () => {
    for (const mimeType of ['image/jpeg', 'image/png', 'image/webp'] as const) {
      expect(
        uploadUrlSchema.parse({
          mimeType,
          fileSizeBytes: 1,
          originalFilename: '  photo.jpg  '
        })
      ).toEqual({
        mimeType,
        fileSizeBytes: 1,
        originalFilename: 'photo.jpg'
      });
    }
  });

  it('allows a missing filename and rejects an empty or oversized one', () => {
    expect(uploadUrlSchema.parse({ mimeType: 'image/webp', fileSizeBytes: 10 }).originalFilename).toBeUndefined();
    expect(uploadUrlSchema.safeParse({ mimeType: 'image/webp', fileSizeBytes: 10, originalFilename: '   ' }).success).toBe(
      false
    );
    expect(
      uploadUrlSchema.safeParse({
        mimeType: 'image/webp',
        fileSizeBytes: 10,
        originalFilename: 'a'.repeat(256)
      }).success
    ).toBe(false);
  });

  it('rejects mime types and file sizes outside the photo rules', () => {
    expect(uploadUrlSchema.safeParse({ mimeType: 'image/gif', fileSizeBytes: 10 }).success).toBe(false);
    expect(uploadUrlSchema.safeParse({ mimeType: 'image/jpeg', fileSizeBytes: 0 }).success).toBe(false);
    expect(uploadUrlSchema.safeParse({ mimeType: 'image/jpeg', fileSizeBytes: -1 }).success).toBe(false);
    expect(uploadUrlSchema.safeParse({ mimeType: 'image/jpeg', fileSizeBytes: 1.5 }).success).toBe(false);
    expect(uploadUrlSchema.safeParse({ mimeType: 'image/jpeg', fileSizeBytes: 10_485_761 }).success).toBe(false);
    expect(uploadUrlSchema.safeParse({ mimeType: 'image/jpeg', fileSizeBytes: '100' }).success).toBe(false);
  });

  it('rejects unexpected upload and confirm fields', () => {
    expect(
      uploadUrlSchema.safeParse({
        mimeType: 'image/jpeg',
        fileSizeBytes: 100,
        userId: photoId
      }).success
    ).toBe(false);
    expect(
      confirmPhotoSchema.safeParse({
        photoId,
        storageKey: 'photos/user/photo.webp',
        displayOrder: 1,
        isPrimary: true,
        mimeType: 'image/jpeg'
      }).success
    ).toBe(false);
  });

  it('requires a uuid, a 1 to 5 display order, and a boolean primary flag', () => {
    expect(
      confirmPhotoSchema.parse({
        photoId,
        storageKey: 'photos/user/photo.webp',
        displayOrder: 5,
        isPrimary: false
      }).displayOrder
    ).toBe(5);
    expect(
      confirmPhotoSchema.safeParse({
        photoId: 'not-a-uuid',
        storageKey: 'photos/user/photo.webp',
        displayOrder: 1,
        isPrimary: true
      }).success
    ).toBe(false);
    expect(
      confirmPhotoSchema.safeParse({
        photoId,
        storageKey: 'photos/user/photo.webp',
        displayOrder: 0,
        isPrimary: true
      }).success
    ).toBe(false);
    expect(
      confirmPhotoSchema.safeParse({
        photoId,
        storageKey: 'photos/user/photo.webp',
        displayOrder: 6,
        isPrimary: true
      }).success
    ).toBe(false);
    expect(
      confirmPhotoSchema.safeParse({
        photoId,
        storageKey: 'photos/user/photo.webp',
        displayOrder: 1,
        isPrimary: 'true'
      }).success
    ).toBe(false);
  });

  it('requires at least one supported patch field and rejects unexpected fields', () => {
    expect(updatePhotoSchema.parse({ displayOrder: 2 })).toEqual({ displayOrder: 2 });
    expect(updatePhotoSchema.parse({ isPrimary: true })).toEqual({ isPrimary: true });
    expect(updatePhotoSchema.safeParse({}).success).toBe(false);
    expect(updatePhotoSchema.safeParse({ displayOrder: 3, storageKey: 'photos/user/photo.webp' }).success).toBe(false);
    expect(updatePhotoSchema.safeParse({ isPrimary: false, userId: photoId }).success).toBe(false);
  });
});
