import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../../config/env';
import { InternalServerError } from '../../utils/errors/internal.error';
import {
  StorageObjectMissingError,
  type CreateDownloadUrlInput,
  type CreateUploadUrlInput,
  type HeadStoredObjectInput,
  type PhotoStorage,
  type SignedObjectUrl,
  type StoredObjectHead
} from './storage.interface';

let client: S3Client | undefined;
let clientRegion: string | undefined;

function storageConfig(): { region: string; bucket: string } {
  if (!env.AWS_REGION || !env.AWS_S3_BUCKET_NAME) {
    throw new InternalServerError('Photo storage is not configured.', [], 'STORAGE_NOT_CONFIGURED', true);
  }

  return {
    region: env.AWS_REGION,
    bucket: env.AWS_S3_BUCKET_NAME
  };
}

function clientFor(region: string): S3Client {
  if (!client || clientRegion !== region) {
    client = new S3Client({ region });
    clientRegion = region;
  }
  return client;
}

function errorName(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return '';
  }
  const named = error as { name?: unknown; Code?: unknown; code?: unknown };
  if (typeof named.name === 'string' && named.name.length > 0) {
    return named.name;
  }
  if (typeof named.Code === 'string' && named.Code.length > 0) {
    return named.Code;
  }
  if (typeof named.code === 'string') {
    return named.code;
  }
  return '';
}

function statusCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const status = (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata?.httpStatusCode;
  return typeof status === 'number' ? status : undefined;
}

function isAccessDenied(error: unknown): boolean {
  const name = errorName(error);
  return statusCode(error) === 403 || name === 'AccessDenied' || name === 'Forbidden';
}

function isMissingObject(error: unknown): boolean {
  const name = errorName(error);
  return statusCode(error) === 404 || name === 'NotFound' || name === 'NoSuchKey';
}

export const photoStorage: PhotoStorage = {
  async createUploadUrl(input: CreateUploadUrlInput): Promise<SignedObjectUrl> {
    const { region, bucket } = storageConfig();
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: input.storageKey,
      ContentType: input.mimeType
    });
    const url = await getSignedUrl(clientFor(region), command, { expiresIn: input.expiresInSeconds });
    return { url, expiresInSeconds: input.expiresInSeconds };
  },

  async createDownloadUrl(input: CreateDownloadUrlInput): Promise<SignedObjectUrl> {
    const { region, bucket } = storageConfig();
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: input.storageKey
    });
    const url = await getSignedUrl(clientFor(region), command, { expiresIn: input.expiresInSeconds });
    return { url, expiresInSeconds: input.expiresInSeconds };
  },

  async headObject(input: HeadStoredObjectInput): Promise<StoredObjectHead> {
    const { region, bucket } = storageConfig();
    try {
      const response = await clientFor(region).send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: input.storageKey
        })
      );
      return {
        contentLength: response.ContentLength,
        contentType: response.ContentType
      };
    } catch (error) {
      if (isAccessDenied(error)) {
        throw new InternalServerError('Media storage could not be accessed.', [], 'STORAGE_ACCESS_DENIED', true);
      }
      if (isMissingObject(error)) {
        throw new StorageObjectMissingError();
      }
      throw new InternalServerError('Media storage is temporarily unavailable.', [], 'STORAGE_UNAVAILABLE', true);
    }
  }
};
