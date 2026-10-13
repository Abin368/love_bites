describe('private S3 photo storage', () => {
  const putInputs: Array<Record<string, unknown>> = [];
  const getInputs: Array<Record<string, unknown>> = [];
  const headInputs: Array<Record<string, unknown>> = [];
  const signed: Array<{ expiresIn?: number }> = [];
  const send = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    putInputs.length = 0;
    getInputs.length = 0;
    headInputs.length = 0;
    signed.length = 0;
    send.mockReset();
    jest.doMock('@aws-sdk/client-s3', () => ({
      S3Client: jest.fn().mockImplementation(() => ({ send })),
      PutObjectCommand: jest.fn().mockImplementation((input: Record<string, unknown>) => {
        putInputs.push(input);
        return { input };
      }),
      GetObjectCommand: jest.fn().mockImplementation((input: Record<string, unknown>) => {
        getInputs.push(input);
        return { input };
      }),
      HeadObjectCommand: jest.fn().mockImplementation((input: Record<string, unknown>) => {
        headInputs.push(input);
        return { input };
      })
    }));
    jest.doMock('@aws-sdk/s3-request-presigner', () => ({
      getSignedUrl: jest.fn(async (_client: unknown, _command: unknown, options: { expiresIn?: number }) => {
        signed.push(options);
        return 'https://signed.example/object';
      })
    }));
  });

  async function loadProvider(config: { AWS_REGION?: string; AWS_S3_BUCKET_NAME?: string }) {
    jest.doMock('../../src/config/env', () => ({
      env: {
        NODE_ENV: 'test',
        ...config
      }
    }));
    return require('../../src/integrations/storage/s3.provider') as typeof import('../../src/integrations/storage/s3.provider');
  }

  it('signs a private put and get without an ACL', async () => {
    const { photoStorage } = await loadProvider({
      AWS_REGION: 'us-east-1',
      AWS_S3_BUCKET_NAME: 'private-test-bucket'
    });

    const upload = await photoStorage.createUploadUrl({
      storageKey: 'photos/user/photo.webp',
      mimeType: 'image/png',
      expiresInSeconds: 300
    });
    const download = await photoStorage.createDownloadUrl({
      storageKey: 'photos/user/photo.webp',
      expiresInSeconds: 3600
    });

    expect(upload).toEqual({ url: 'https://signed.example/object', expiresInSeconds: 300 });
    expect(download.expiresInSeconds).toBe(3600);
    expect(putInputs[0]).toEqual({
      Bucket: 'private-test-bucket',
      Key: 'photos/user/photo.webp',
      ContentType: 'image/png'
    });
    expect(putInputs[0]).not.toHaveProperty('ACL');
    expect(JSON.stringify(putInputs[0])).not.toContain('public-read');
    expect(getInputs[0]).toEqual({
      Bucket: 'private-test-bucket',
      Key: 'photos/user/photo.webp'
    });
    expect(getInputs[0]).not.toHaveProperty('ACL');
    expect(signed.map((item) => item.expiresIn)).toEqual([300, 3600]);
  });

  it('returns head metadata for the configured bucket and key', async () => {
    const { photoStorage } = await loadProvider({
      AWS_REGION: 'us-east-1',
      AWS_S3_BUCKET_NAME: 'private-test-bucket'
    });
    send.mockResolvedValue({ ContentLength: 2048, ContentType: 'image/png' });

    const head = await photoStorage.headObject({ storageKey: 'chat-media/conversation/upload' });

    expect(head).toEqual({ contentLength: 2048, contentType: 'image/png' });
    expect(headInputs).toEqual([{ Bucket: 'private-test-bucket', Key: 'chat-media/conversation/upload' }]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('maps a missing object without leaking the provider message', async () => {
    const { photoStorage } = await loadProvider({
      AWS_REGION: 'us-east-1',
      AWS_S3_BUCKET_NAME: 'private-test-bucket'
    });
    send.mockRejectedValue(
      Object.assign(new Error('The specified key does not exist. secret-bucket-arn'), {
        name: 'NotFound',
        $metadata: { httpStatusCode: 404 }
      })
    );

    await expect(photoStorage.headObject({ storageKey: 'chat-media/conversation/missing' })).rejects.toMatchObject({
      name: 'StorageObjectMissingError',
      message: 'Stored object was not found.'
    });
  });

  it('treats access denied, including a 403 named NotFound, as a sanitized storage error', async () => {
    const { photoStorage } = await loadProvider({
      AWS_REGION: 'us-east-1',
      AWS_S3_BUCKET_NAME: 'private-test-bucket'
    });
    send.mockRejectedValueOnce(
      Object.assign(new Error('AccessDenied arn:aws:s3:::secret-bucket'), {
        name: 'AccessDenied',
        $metadata: { httpStatusCode: 403 }
      })
    );

    await expect(photoStorage.headObject({ storageKey: 'chat-media/conversation/denied' })).rejects.toMatchObject({
      errorCode: 'STORAGE_ACCESS_DENIED',
      message: 'Media storage could not be accessed.'
    });

    send.mockRejectedValueOnce(
      Object.assign(new Error('NotFound hidden-arn'), {
        name: 'NotFound',
        $metadata: { httpStatusCode: 403 }
      })
    );
    await expect(photoStorage.headObject({ storageKey: 'chat-media/conversation/denied' })).rejects.toMatchObject({
      errorCode: 'STORAGE_ACCESS_DENIED'
    });
  });

  it('sanitizes transient storage failures', async () => {
    const { photoStorage } = await loadProvider({
      AWS_REGION: 'us-east-1',
      AWS_S3_BUCKET_NAME: 'private-test-bucket'
    });
    send.mockRejectedValue(
      Object.assign(new Error('SlowDown secret-request-id'), {
        name: 'SlowDown',
        $metadata: { httpStatusCode: 503 }
      })
    );

    await expect(photoStorage.headObject({ storageKey: 'chat-media/conversation/retry' })).rejects.toMatchObject({
      errorCode: 'STORAGE_UNAVAILABLE',
      message: 'Media storage is temporarily unavailable.'
    });
  });

  it('does not head an object when photo storage is not configured', async () => {
    const { photoStorage } = await loadProvider({});
    await expect(photoStorage.headObject({ storageKey: 'chat-media/conversation/upload' })).rejects.toMatchObject({
      errorCode: 'STORAGE_NOT_CONFIGURED',
      message: 'Photo storage is not configured.'
    });
    expect(send).not.toHaveBeenCalled();
    expect(headInputs).toHaveLength(0);
  });

  it('does not sign when photo storage is not configured', async () => {
    const { photoStorage } = await loadProvider({});
    await expect(
      photoStorage.createUploadUrl({
        storageKey: 'photos/user/photo.webp',
        mimeType: 'image/jpeg',
        expiresInSeconds: 300
      })
    ).rejects.toMatchObject({ errorCode: 'STORAGE_NOT_CONFIGURED' });
    expect(putInputs).toHaveLength(0);
  });
});
