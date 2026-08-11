import { describe, expect, it, vi } from 'vitest';

import type { Client as MinioClient } from 'minio';
import { MinioStorageAdapter } from '../src/infrastructure/storage/minio-storage-adapter.js';

const EXPECTED = { contentType: 'model/gltf-binary', sizeBytes: 1024 };

function createClient() {
  const bucketExists = vi.fn<MinioClient['bucketExists']>().mockResolvedValue(true);
  const makeBucket = vi.fn<MinioClient['makeBucket']>().mockResolvedValue(undefined);
  const presignedPutObject = vi
    .fn<MinioClient['presignedPutObject']>()
    .mockResolvedValue('http://minio/bucket/scans/scan-1/model?X-Amz-Expires=900');
  const presignedGetObject = vi
    .fn<MinioClient['presignedGetObject']>()
    .mockResolvedValue('http://minio/bucket/scans/scan-1/model?X-Amz-Expires=60');
  const statObject = vi
    .fn<MinioClient['statObject']>()
    .mockResolvedValue({ size: 1024, metaData: { 'content-type': 'model/gltf-binary' } } as never);

  const client = {
    bucketExists,
    makeBucket,
    presignedPutObject,
    presignedGetObject,
    statObject,
  } as unknown as MinioClient;

  return { client, bucketExists, makeBucket, presignedPutObject, presignedGetObject, statObject };
}

function createAdapter(client: MinioClient = createClient().client) {
  return new MinioStorageAdapter({
    bucket: 'roomscan-assets',
    endPoint: 'localhost:9000',
    accessKey: 'access-key',
    secretKey: 'secret-key',
    useSSL: false,
    region: 'us-east-1',
    client,
  });
}

describe('MinioStorageAdapter', () => {
  it('builds a namespaced object key per scan and asset type', () => {
    const adapter = createAdapter();

    expect(adapter.buildObjectKey('scan-1', 'MODEL')).toBe('scans/scan-1/model');
    expect(adapter.buildObjectKey('scan-1', 'THUMBNAIL')).toBe('scans/scan-1/thumbnail');
  });

  it('creates the bucket lazily on first use and reuses it afterwards', async () => {
    const { client, bucketExists, makeBucket } = createClient();
    bucketExists.mockResolvedValueOnce(false);
    const adapter = createAdapter(client);
    const options = {
      contentType: 'model/gltf-binary',
      sizeBytes: 1024,
      expiresAt: new Date(Date.now() + 60_000),
    };

    await adapter.createUploadUrl('scans/scan-1/model', options);
    await adapter.createUploadUrl('scans/scan-1/model', options);

    expect(bucketExists).toHaveBeenCalledTimes(1);
    expect(makeBucket).toHaveBeenCalledTimes(1);
    expect(makeBucket).toHaveBeenCalledWith('roomscan-assets', 'us-east-1');
  });

  it('does not create an existing bucket', async () => {
    const { client, makeBucket } = createClient();
    const adapter = createAdapter(client);

    await adapter.verifyObject('scans/scan-1/model', EXPECTED);

    expect(makeBucket).not.toHaveBeenCalled();
  });

  it('retries bucket creation after a failure', async () => {
    const { client, bucketExists, makeBucket } = createClient();
    bucketExists.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(false);
    const adapter = createAdapter(client);
    const options = {
      contentType: 'model/gltf-binary',
      sizeBytes: 1024,
      expiresAt: new Date(Date.now() + 60_000),
    };

    await expect(adapter.createUploadUrl('scans/scan-1/model', options)).rejects.toThrow('down');
    await expect(adapter.createUploadUrl('scans/scan-1/model', options)).resolves.toBeDefined();

    expect(bucketExists).toHaveBeenCalledTimes(2);
    expect(makeBucket).toHaveBeenCalledTimes(1);
  });

  it('mints a presigned upload URL with a positive expiry', async () => {
    const { client, presignedPutObject } = createClient();
    const adapter = createAdapter(client);
    const expiresAt = new Date(Date.now() + 120_000);

    const url = await adapter.createUploadUrl('scans/scan-1/model', {
      contentType: 'model/gltf-binary',
      sizeBytes: 1024,
      expiresAt,
    });

    expect(url.url).toBe('http://minio/bucket/scans/scan-1/model?X-Amz-Expires=900');
    expect(url.expiresAt).toEqual(expiresAt);
    expect(presignedPutObject).toHaveBeenCalledWith(
      'roomscan-assets',
      'scans/scan-1/model',
      expect.any(Number),
    );
    const expiry = presignedPutObject.mock.calls[0]?.[2] ?? 0;
    expect(expiry).toBeGreaterThanOrEqual(1);
    expect(expiry).toBeLessThanOrEqual(120);
  });

  it('mints a presigned download URL', async () => {
    const { client, presignedGetObject } = createClient();
    const adapter = createAdapter(client);
    const expiresAt = new Date(Date.now() + 60_000);

    const url = await adapter.createDownloadUrl('scans/scan-1/model', { expiresAt });

    expect(url.url).toBe('http://minio/bucket/scans/scan-1/model?X-Amz-Expires=60');
    expect(url.expiresAt).toEqual(expiresAt);
    expect(presignedGetObject).toHaveBeenCalledWith(
      'roomscan-assets',
      'scans/scan-1/model',
      expect.any(Number),
    );
  });

  it('accepts an upload when size and content type match the session', async () => {
    const { client } = createClient();
    const adapter = createAdapter(client);

    await expect(adapter.verifyObject('scans/scan-1/model', EXPECTED)).resolves.toBe(true);
  });

  it('rejects an upload whose size does not match the session', async () => {
    const { client, statObject } = createClient();
    statObject.mockResolvedValueOnce({
      size: 2048,
      metaData: { 'content-type': 'model/gltf-binary' },
    } as never);
    const adapter = createAdapter(client);

    await expect(adapter.verifyObject('scans/scan-1/model', EXPECTED)).resolves.toBe(false);
  });

  it('rejects an upload whose content type does not match the session', async () => {
    const { client, statObject } = createClient();
    statObject.mockResolvedValueOnce({
      size: 1024,
      metaData: { 'content-type': 'application/octet-stream' },
    } as never);
    const adapter = createAdapter(client);

    await expect(adapter.verifyObject('scans/scan-1/model', EXPECTED)).resolves.toBe(false);
  });

  it('rejects an upload when the object is missing', async () => {
    const { client, statObject } = createClient();
    statObject.mockRejectedValueOnce(
      Object.assign(new Error('The specified key does not exist.'), { code: 'NoSuchKey' }),
    );
    const adapter = createAdapter(client);

    await expect(adapter.verifyObject('scans/scan-1/model', EXPECTED)).resolves.toBe(false);
  });

  it('propagates storage errors instead of hiding them as missing objects', async () => {
    const { client, statObject } = createClient();
    statObject.mockRejectedValueOnce(new Error('connection refused'));
    const adapter = createAdapter(client);

    await expect(adapter.verifyObject('scans/scan-1/model', EXPECTED)).rejects.toThrow(
      'connection refused',
    );
  });

  it('returns a stable display URL derived from the endpoint', async () => {
    const adapter = createAdapter();

    await expect(adapter.createDisplayUrl('scans/scan-1/thumbnail')).resolves.toBe(
      'http://localhost:9000/roomscan-assets/scans/scan-1/thumbnail',
    );
  });

  it('honors a configured display base URL and HTTPS', async () => {
    const adapter = new MinioStorageAdapter({
      bucket: 'roomscan-assets',
      endPoint: 'minio.internal:9000',
      accessKey: 'access-key',
      secretKey: 'secret-key',
      useSSL: true,
      displayBaseUrl: 'https://cdn.roomscan.dev',
      client: createClient().client,
    });

    await expect(adapter.createDisplayUrl('scans/scan-1/thumbnail')).resolves.toBe(
      'https://cdn.roomscan.dev/roomscan-assets/scans/scan-1/thumbnail',
    );
  });
});
