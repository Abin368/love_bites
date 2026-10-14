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

export interface HeadStoredObjectInput {
  storageKey: string;
}

export interface StoredObjectHead {
  contentLength?: number;
  contentType?: string;
}

export class StorageObjectMissingError extends Error {
  constructor() {
    super('Stored object was not found.');
    this.name = 'StorageObjectMissingError';
  }
}

export interface PhotoStorage {
  createUploadUrl(input: CreateUploadUrlInput): Promise<SignedObjectUrl>;
  createDownloadUrl(input: CreateDownloadUrlInput): Promise<SignedObjectUrl>;
  headObject(input: HeadStoredObjectInput): Promise<StoredObjectHead>;
}
