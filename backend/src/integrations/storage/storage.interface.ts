export interface SignedObjectUrl {
  url: string;
  expiresInSeconds: number;
}

export interface CreateUploadUrlInput {
  storageKey: string;
  mimeType: string;
  expiresInSeconds: number;
}

export interface CreateDownloadUrlInput {
  storageKey: string;
  expiresInSeconds: number;
}

export interface PhotoStorage {
  createUploadUrl(input: CreateUploadUrlInput): Promise<SignedObjectUrl>;
  createDownloadUrl(input: CreateDownloadUrlInput): Promise<SignedObjectUrl>;
}
