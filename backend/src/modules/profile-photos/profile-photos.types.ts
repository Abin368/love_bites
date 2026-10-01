export const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type PhotoMimeType = (typeof PHOTO_MIME_TYPES)[number];

export interface ProfilePhotoResponse {
  id: string;
  url: string;
  displayOrder: number;
  isPrimary: boolean;
}

export interface UploadUrlResponse {
  photoId: string;
  uploadUrl: string;
  storageKey: string;
  expiresInSeconds: number;
}

export interface UploadReservation {
  userId: string;
  photoId: string;
  storageKey: string;
  mimeType: PhotoMimeType;
  fileSizeBytes: number;
  originalFilename: string | null;
}

export interface InsertProfilePhotoInput {
  photoId: string;
  userId: string;
  storageKey: string;
  originalFilename: string | null;
  mimeType: PhotoMimeType;
  fileSizeBytes: number;
  displayOrder: number;
  isPrimary: boolean;
}
