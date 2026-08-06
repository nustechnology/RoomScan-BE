import { describe, expect, it } from 'vitest';

import { LocalStorageAdapter } from '../src/infrastructure/storage/local-storage-adapter.js';

describe('LocalStorageAdapter', () => {
  it('builds a namespaced object key per scan and asset type', () => {
    const adapter = new LocalStorageAdapter();

    expect(adapter.buildObjectKey('scan-1', 'MODEL')).toBe('scans/scan-1/model');
    expect(adapter.buildObjectKey('scan-1', 'THUMBNAIL')).toBe('scans/scan-1/thumbnail');
  });

  it('mints an upload URL with the requested expiry and payload metadata', async () => {
    const expiresAt = new Date('2026-08-01T10:00:00.000Z');
    const adapter = new LocalStorageAdapter({ baseUrl: 'http://minio.local' });

    const url = await adapter.createUploadUrl('scans/scan-1/model', {
      contentType: 'model/gltf-binary',
      sizeBytes: 1024,
      expiresAt,
    });

    expect(url.expiresAt).toEqual(expiresAt);
    expect(url.url).toContain('http://minio.local/upload/scans/scan-1/model');
    expect(url.url).toContain('contentType=model%2Fgltf-binary');
    expect(url.url).toContain('sizeBytes=1024');
  });

  it('mints a short-lived download URL', async () => {
    const expiresAt = new Date('2026-08-01T10:00:01.000Z');
    const adapter = new LocalStorageAdapter();

    const url = await adapter.createDownloadUrl('scans/scan-1/model', { expiresAt });

    expect(url.url).toBe('http://storage.local/download/scans/scan-1/model');
    expect(url.expiresAt).toEqual(expiresAt);
  });

  it('cannot verify objects independently and assumes the upload is valid', async () => {
    const adapter = new LocalStorageAdapter();

    await expect(adapter.verifyObject('scans/scan-1/model')).resolves.toBe(true);
  });
});
