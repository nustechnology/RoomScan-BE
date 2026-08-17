import { describe, expect, it, vi } from 'vitest';

import { ProjectNotFoundError } from '../src/modules/project/project.errors.js';
import { ScanNotFoundError } from '../src/modules/scan/scan.errors.js';
import {
  NotOwnerError,
  ProjectNotShareableError,
  ScanNotShareableError,
  ShareLinkNotFoundError,
} from '../src/modules/share/share.errors.js';
import { ShareLinkService } from '../src/modules/share/share-link.service.js';
import type { ShareLinkRecord, ShareRepository } from '../src/modules/share/share.types.js';

const NOW = new Date('2026-07-29T10:00:00.000Z');
const OWNER_ID = 'eb5d278f-c857-45c7-887d-7be65288cb75';
const OTHER_ID = '8c53d31d-2788-48de-82a0-c4f219ca3701';
const PROJECT_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const SCAN_ID = 'f1e2d3c4-a5b6-7890-abcd-ef1234567890';
const SHARE_LINK_ID = 'c0ffee00-0000-4000-8000-0000000000aa';
const BASE_URL = 'https://invite.roomscan.dev';
const TTL = 7 * 24 * 60 * 60;

function shareLinkRecord(overrides: Partial<ShareLinkRecord> = {}): ShareLinkRecord {
  return {
    id: SHARE_LINK_ID,
    projectId: PROJECT_ID,
    scanId: null,
    createdById: OWNER_ID,
    tokenHash: 'b'.repeat(64),
    expiresAt: new Date(NOW.getTime() + TTL * 1000),
    revokedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function createService(overrides: Partial<ShareRepository> = {}) {
  const mocks = {
    findProjectOwner: vi.fn<ShareRepository['findProjectOwner']>().mockResolvedValue(OWNER_ID),
    findProjectInfo: vi.fn<ShareRepository['findProjectInfo']>(),
    findScanInfo: vi.fn<ShareRepository['findScanInfo']>().mockResolvedValue({
      name: 'Living Room',
      projectId: PROJECT_ID,
      ownerId: OWNER_ID,
      ownerEmail: 'owner@example.com',
    }),
    hasUploadedModel: vi.fn<ShareRepository['hasUploadedModel']>().mockResolvedValue(true),
    hasUploadedScanModel: vi.fn<ShareRepository['hasUploadedScanModel']>().mockResolvedValue(true),
    createInvitation: vi.fn<ShareRepository['createInvitation']>(),
    findByTokenHash: vi.fn<ShareRepository['findByTokenHash']>(),
    findInvitationById: vi.fn<ShareRepository['findInvitationById']>(),
    acceptInvitation: vi.fn<ShareRepository['acceptInvitation']>(),
    acceptScanInvitation: vi.fn<ShareRepository['acceptScanInvitation']>(),
    declineInvitation: vi.fn<ShareRepository['declineInvitation']>(),
    revokeInvitation: vi.fn<ShareRepository['revokeInvitation']>(),
    resendInvitation: vi.fn<ShareRepository['resendInvitation']>(),
    listPendingByProject: vi.fn<ShareRepository['listPendingByProject']>(),
    listPendingByScan: vi.fn<ShareRepository['listPendingByScan']>(),
    findActiveViewerAccess: vi.fn<ShareRepository['findActiveViewerAccess']>(),
    findActiveScanAccess: vi.fn<ShareRepository['findActiveScanAccess']>(),
    listActiveViewers: vi.fn<ShareRepository['listActiveViewers']>(),
    listActiveScanViewers: vi.fn<ShareRepository['listActiveScanViewers']>(),
    revokeViewerAccess: vi.fn<ShareRepository['revokeViewerAccess']>(),
    revokeScanViewerAccess: vi.fn<ShareRepository['revokeScanViewerAccess']>(),
    createShareLink: vi
      .fn<ShareRepository['createShareLink']>()
      .mockResolvedValue(shareLinkRecord()),
    findShareLinkByTokenHash: vi.fn<ShareRepository['findShareLinkByTokenHash']>(),
    listShareLinksByResource: vi
      .fn<ShareRepository['listShareLinksByResource']>()
      .mockResolvedValue([shareLinkRecord()]),
    findShareLinkById: vi
      .fn<ShareRepository['findShareLinkById']>()
      .mockResolvedValue(shareLinkRecord()),
    revokeShareLink: vi
      .fn<ShareRepository['revokeShareLink']>()
      .mockResolvedValue(shareLinkRecord({ revokedAt: NOW })),
    grantProjectAccess: vi.fn<ShareRepository['grantProjectAccess']>(),
    grantScanAccess: vi.fn<ShareRepository['grantScanAccess']>(),
  };
  const repository: ShareRepository = { ...mocks, ...overrides };
  const service = new ShareLinkService({
    repository,
    clock: () => NOW,
    invitationTtlSeconds: TTL,
    invitationBaseUrl: BASE_URL,
  });
  return { service, mocks };
}

describe('ShareLinkService.createShareLink', () => {
  it('creates a reusable project share link without an email', async () => {
    const { service, mocks } = createService();

    const result = await service.createShareLink(OWNER_ID, { projectId: PROJECT_ID });

    expect(result).toEqual(
      expect.objectContaining({
        shareLinkId: SHARE_LINK_ID,
        scope: 'project',
        expiresAt: new Date(NOW.getTime() + TTL * 1000).toISOString(),
      }),
    );
    expect(result.shareLinkUrl).toContain(`${BASE_URL}/invitations/`);
    const createData = mocks.createShareLink.mock.calls[0]?.[0];
    expect(createData).toEqual(
      expect.objectContaining({
        projectId: PROJECT_ID,
        createdById: OWNER_ID,
        expiresAt: new Date(NOW.getTime() + TTL * 1000),
      }),
    );
    expect(createData?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('creates a scan share link', async () => {
    const { service, mocks } = createService();

    const result = await service.createShareLink(OWNER_ID, { scanId: SCAN_ID });

    expect(result.scope).toBe('scan');
    const createData = mocks.createShareLink.mock.calls[0]?.[0];
    expect(createData).toEqual(expect.objectContaining({ scanId: SCAN_ID }));
  });

  it('rejects a non-owner with NotOwnerError', async () => {
    const { service } = createService({
      findProjectOwner: vi.fn().mockResolvedValue(OTHER_ID),
    });

    await expect(
      service.createShareLink(OWNER_ID, { projectId: PROJECT_ID }),
    ).rejects.toBeInstanceOf(NotOwnerError);
  });

  it('rejects when the project has no uploaded model', async () => {
    const { service } = createService({
      hasUploadedModel: vi.fn().mockResolvedValue(false),
    });

    await expect(
      service.createShareLink(OWNER_ID, { projectId: PROJECT_ID }),
    ).rejects.toBeInstanceOf(ProjectNotShareableError);
  });

  it('rejects when the scan has no uploaded model', async () => {
    const { service } = createService({
      hasUploadedScanModel: vi.fn().mockResolvedValue(false),
    });

    await expect(service.createShareLink(OWNER_ID, { scanId: SCAN_ID })).rejects.toBeInstanceOf(
      ScanNotShareableError,
    );
  });

  it('rejects a missing scan', async () => {
    const { service } = createService({
      findScanInfo: vi.fn().mockResolvedValue(null),
    });

    await expect(service.createShareLink(OWNER_ID, { scanId: SCAN_ID })).rejects.toBeInstanceOf(
      ScanNotFoundError,
    );
  });

  it('rejects a missing project', async () => {
    const { service } = createService({
      findProjectOwner: vi.fn().mockResolvedValue(null),
    });

    await expect(
      service.createShareLink(OWNER_ID, { projectId: PROJECT_ID }),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it('rejects a non-owner for a scan link', async () => {
    const { service } = createService({
      findScanInfo: vi.fn().mockResolvedValue({
        name: 'Living Room',
        projectId: PROJECT_ID,
        ownerId: OTHER_ID,
        ownerEmail: null,
      }),
    });

    await expect(service.createShareLink(OWNER_ID, { scanId: SCAN_ID })).rejects.toBeInstanceOf(
      NotOwnerError,
    );
  });
});

describe('ShareLinkService.listShareLinks', () => {
  it('lists the active links for the owner', async () => {
    const { service, mocks } = createService();

    const result = await service.listShareLinks(OWNER_ID, { projectId: PROJECT_ID });

    expect(result).toEqual([
      {
        shareLinkId: SHARE_LINK_ID,
        status: 'ACTIVE',
        expiresAt: new Date(NOW.getTime() + TTL * 1000).toISOString(),
        createdAt: NOW.toISOString(),
      },
    ]);
    expect(mocks.listShareLinksByResource).toHaveBeenCalledWith({ projectId: PROJECT_ID });
  });

  it('lists scan share links', async () => {
    const { service, mocks } = createService();

    const result = await service.listShareLinks(OWNER_ID, { scanId: SCAN_ID });

    expect(result).toHaveLength(1);
    expect(mocks.listShareLinksByResource).toHaveBeenCalledWith({ scanId: SCAN_ID });
  });

  it('reports an expired unrevoked link as EXPIRED', async () => {
    const { service } = createService({
      listShareLinksByResource: vi
        .fn()
        .mockResolvedValue([shareLinkRecord({ expiresAt: new Date(NOW.getTime() - 1000) })]),
    });

    const result = await service.listShareLinks(OWNER_ID, { projectId: PROJECT_ID });

    expect(result[0]?.status).toBe('EXPIRED');
  });

  it('rejects a non-owner', async () => {
    const { service } = createService({
      findProjectOwner: vi.fn().mockResolvedValue(OTHER_ID),
    });

    await expect(
      service.listShareLinks(OWNER_ID, { projectId: PROJECT_ID }),
    ).rejects.toBeInstanceOf(NotOwnerError);
  });

  it('rejects a missing scan', async () => {
    const { service } = createService({ findScanInfo: vi.fn().mockResolvedValue(null) });

    await expect(service.listShareLinks(OWNER_ID, { scanId: SCAN_ID })).rejects.toBeInstanceOf(
      ScanNotFoundError,
    );
  });
});

describe('ShareLinkService.revokeShareLink', () => {
  it('revokes an active share link as the owner', async () => {
    const { service, mocks } = createService();

    const result = await service.revokeShareLink(OWNER_ID, SHARE_LINK_ID);

    expect(result).toEqual({
      shareLinkId: SHARE_LINK_ID,
      status: 'REVOKED',
      revokedAt: NOW.toISOString(),
    });
    expect(mocks.revokeShareLink).toHaveBeenCalledWith(SHARE_LINK_ID, NOW);
  });

  it('is idempotent for an already revoked share link', async () => {
    const { service, mocks } = createService({
      findShareLinkById: vi.fn().mockResolvedValue(shareLinkRecord({ revokedAt: NOW })),
    });

    const result = await service.revokeShareLink(OWNER_ID, SHARE_LINK_ID);

    expect(result.revokedAt).toBe(NOW.toISOString());
    expect(mocks.revokeShareLink).not.toHaveBeenCalled();
  });

  it('returns REVOKED when a concurrent revoke wins the update', async () => {
    const { service, mocks } = createService();
    mocks.findShareLinkById
      .mockResolvedValueOnce(shareLinkRecord())
      .mockResolvedValueOnce(shareLinkRecord({ revokedAt: NOW }));
    mocks.revokeShareLink.mockResolvedValue(null);

    const result = await service.revokeShareLink(OWNER_ID, SHARE_LINK_ID);

    expect(result).toEqual({
      shareLinkId: SHARE_LINK_ID,
      status: 'REVOKED',
      revokedAt: NOW.toISOString(),
    });
  });

  it('throws when the re-read confirms the link is gone', async () => {
    const { service, mocks } = createService();
    mocks.findShareLinkById.mockResolvedValueOnce(shareLinkRecord()).mockResolvedValueOnce(null);
    mocks.revokeShareLink.mockResolvedValue(null);

    await expect(service.revokeShareLink(OWNER_ID, SHARE_LINK_ID)).rejects.toBeInstanceOf(
      ShareLinkNotFoundError,
    );
  });

  it('rejects an unknown share link', async () => {
    const { service } = createService({
      findShareLinkById: vi.fn().mockResolvedValue(null),
    });

    await expect(service.revokeShareLink(OWNER_ID, SHARE_LINK_ID)).rejects.toBeInstanceOf(
      ShareLinkNotFoundError,
    );
  });

  it('rejects a non-owner', async () => {
    const { service, mocks } = createService({
      findProjectOwner: vi.fn().mockResolvedValue(OTHER_ID),
    });

    await expect(service.revokeShareLink(OWNER_ID, SHARE_LINK_ID)).rejects.toBeInstanceOf(
      NotOwnerError,
    );
    expect(mocks.revokeShareLink).not.toHaveBeenCalled();
  });

  it('rejects when the owning project is deleted', async () => {
    const { service } = createService({
      findProjectOwner: vi.fn().mockResolvedValue(null),
    });

    await expect(service.revokeShareLink(OWNER_ID, SHARE_LINK_ID)).rejects.toBeInstanceOf(
      ProjectNotFoundError,
    );
  });

  it('revokes a scan share link as the owner', async () => {
    const { service, mocks } = createService({
      findShareLinkById: vi.fn().mockResolvedValue({
        ...shareLinkRecord(),
        projectId: null,
        scanId: SCAN_ID,
      }),
    });

    const result = await service.revokeShareLink(OWNER_ID, SHARE_LINK_ID);

    expect(result.status).toBe('REVOKED');
    expect(mocks.revokeShareLink).toHaveBeenCalledWith(SHARE_LINK_ID, NOW);
  });

  it('rejects a non-owner for a scan share link', async () => {
    const { service, mocks } = createService({
      findShareLinkById: vi.fn().mockResolvedValue({
        ...shareLinkRecord(),
        projectId: null,
        scanId: SCAN_ID,
      }),
      findScanInfo: vi.fn().mockResolvedValue({
        name: 'Living Room',
        projectId: PROJECT_ID,
        ownerId: OTHER_ID,
        ownerEmail: null,
      }),
    });

    await expect(service.revokeShareLink(OWNER_ID, SHARE_LINK_ID)).rejects.toBeInstanceOf(
      NotOwnerError,
    );
    expect(mocks.revokeShareLink).not.toHaveBeenCalled();
  });
});
