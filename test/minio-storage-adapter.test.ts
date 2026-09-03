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
  const removeObject = vi.fn<MinioClient['removeObject']>().mockResolvedValue(undefined);

  const client = {
    bucketExists,
    makeBucket,
    presignedPutObject,
    presignedGetObject,
    statObject,
    removeObject,
  } as unknown as MinioClient;

  return {
    client,
    bucketExists,
    makeBucket,
    presignedPutObject,
    presignedGetObject,
    statObject,
    removeObject,
  };
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
  it('constructs real internal and public MinIO clients when none are injected', () => {
    const adapter = new MinioStorageAdapter({
      bucket: 'roomscan-assets',
      endPoint: 'localhost:9000',
      accessKey: 'access-key',
      secretKey: 'secret-key',
    });

    expect(adapter).toBeInstanceOf(MinioStorageAdapter);
  });

  it('constructs a dedicated public client when only the public endpoint override is given', () => {
    const adapter = new MinioStorageAdapter({
      bucket: 'roomscan-assets',
      endPoint: 'minio:9000',
      accessKey: 'access-key',
      secretKey: 'secret-key',
      useSSL: false,
      region: 'us-east-1',
      publicEndPoint: 'storage.roomscan.example',
      publicUseSSL: true,
      client: createClient().client,
    });

    expect(adapter).toBeInstanceOf(MinioStorageAdapter);
  });

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

  it('deletes an object', async () => {
    const { client, removeObject } = createClient();
    const adapter = createAdapter(client);

    await adapter.deleteObject('scans/scan-1/model');

    expect(removeObject).toHaveBeenCalledWith('roomscan-assets', 'scans/scan-1/model');
  });

  it('treats a missing object as a successful delete', async () => {
    const { client, removeObject } = createClient();
    removeObject.mockRejectedValueOnce(
      Object.assign(new Error('The specified key does not exist.'), { code: 'NoSuchKey' }),
    );
    const adapter = createAdapter(client);

    await expect(adapter.deleteObject('scans/scan-1/model')).resolves.toBeUndefined();
  });

  it('propagates a non-missing-object error from a delete', async () => {
    const { client, removeObject } = createClient();
    removeObject.mockRejectedValueOnce(new Error('connection refused'));
    const adapter = createAdapter(client);

    await expect(adapter.deleteObject('scans/scan-1/model')).rejects.toThrow('connection refused');
  });

  it('returns a stable display URL derived from the endpoint', async () => {
    const adapter = createAdapter();

    await expect(adapter.createDisplayUrl('scans/scan-1/thumbnail')).resolves.toBe(
      'http://localhost:9000/roomscan-assets/scans/scan-1/thumbnail',
    );
  });

  it('does not invent a port for an endpoint that has none', async () => {
    const adapter = new MinioStorageAdapter({
      bucket: 'roomscan-assets',
      endPoint: 'storage.roomscan.example',
      accessKey: 'access-key',
      secretKey: 'secret-key',
      useSSL: true,
      client: createClient().client,
    });

    await expect(adapter.createDisplayUrl('scans/scan-1/thumbnail')).resolves.toBe(
      'https://storage.roomscan.example/roomscan-assets/scans/scan-1/thumbnail',
    );
  });

  it('signs presigned URLs against a separate public endpoint, keeping bucket/stat calls on the internal one', async () => {
    const internal = createClient();
    const publicSide = createClient();
    const adapter = new MinioStorageAdapter({
      bucket: 'roomscan-assets',
      endPoint: 'minio:9000',
      accessKey: 'access-key',
      secretKey: 'secret-key',
      useSSL: false,
      publicEndPoint: 'storage.roomscan.example',
      publicUseSSL: true,
      client: internal.client,
      publicClient: publicSide.client,
    });
    const expiresAt = new Date(Date.now() + 60_000);

    await adapter.createUploadUrl('scans/scan-1/model', {
      contentType: 'model/gltf-binary',
      sizeBytes: 1024,
      expiresAt,
    });
    await adapter.createDownloadUrl('scans/scan-1/model', { expiresAt });
    await adapter.verifyObject('scans/scan-1/model', EXPECTED);

    expect(internal.bucketExists).toHaveBeenCalled();
    expect(internal.statObject).toHaveBeenCalled();
    expect(internal.presignedPutObject).not.toHaveBeenCalled();
    expect(internal.presignedGetObject).not.toHaveBeenCalled();

    expect(publicSide.presignedPutObject).toHaveBeenCalledWith(
      'roomscan-assets',
      'scans/scan-1/model',
      expect.any(Number),
    );
    expect(publicSide.presignedGetObject).toHaveBeenCalledWith(
      'roomscan-assets',
      'scans/scan-1/model',
      expect.any(Number),
    );
    expect(publicSide.bucketExists).not.toHaveBeenCalled();
    expect(publicSide.statObject).not.toHaveBeenCalled();
  });

  it('reuses the same client for presigned URLs when no public endpoint override is given', async () => {
    const { client, presignedPutObject, bucketExists } = createClient();
    const adapter = createAdapter(client);

    await adapter.createUploadUrl('scans/scan-1/model', {
      contentType: 'model/gltf-binary',
      sizeBytes: 1024,
      expiresAt: new Date(Date.now() + 60_000),
    });

    expect(bucketExists).toHaveBeenCalled();
    expect(presignedPutObject).toHaveBeenCalled();
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

  it('derives the display URL from the public endpoint when one is configured', async () => {
    const adapter = new MinioStorageAdapter({
      bucket: 'roomscan-assets',
      endPoint: 'minio:9000',
      accessKey: 'access-key',
      secretKey: 'secret-key',
      useSSL: false,
      publicEndPoint: 'storage.roomscan.example',
      publicUseSSL: true,
      client: createClient().client,
    });

    await expect(adapter.createDisplayUrl('scans/scan-1/thumbnail')).resolves.toBe(
      'https://storage.roomscan.example/roomscan-assets/scans/scan-1/thumbnail',
    );
  });
});
