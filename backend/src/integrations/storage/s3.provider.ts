import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../../config/env';
import { InternalServerError } from '../../utils/errors/internal.error';
import type { CreateDownloadUrlInput, CreateUploadUrlInput, PhotoStorage, SignedObjectUrl } from './storage.interface';

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
  }
};
