import type { ScanSort } from '../scan/scan.types.js';

export type SharedScanStatus = 'ACTIVE' | 'REVOKED' | 'SCAN_DELETED' | 'TEMPORARILY_UNAVAILABLE';

export interface SharedScanRecord {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  thumbnail: string | null;
  creator: {
    id: string;
    email: string | null;
  };
  noteCount: number;
  assetStatus: 'NONE' | 'PENDING' | 'UPLOADING' | 'UPLOADED' | 'FAILED';
  syncStatus: 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED' | 'CONFLICT';
  modelVersion: number;
  updatedAt: Date;
  scanDeletedAt: Date | null;
  accessRevokedAt: Date | null;
  accessDeletedAt: Date | null;
}

export interface SharedScanResult {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  thumbnail: string | null;
  creator: {
    id: string;
    email: string | null;
  };
  noteCount: number;
  assetStatus: SharedScanRecord['assetStatus'];
  syncStatus: SharedScanRecord['syncStatus'];
  modelVersion: number;
  updatedAt: string;
  status: SharedScanStatus;
  permissions: {
    role: 'VIEWER';
    canView: boolean;
    canEdit: false;
    canDelete: false;
  };
}

export interface SharedScansListOptions {
  search?: string;
  page: number;
  limit: number;
  sort: ScanSort;
}

export interface SharedScansListResult {
  items: SharedScanResult[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface SharedScanRemoveResult {
  scanId: string;
  removedAt: string;
}

export interface SharedScansRepository {
  list(
    userId: string,
    options: SharedScansListOptions,
  ): Promise<{ items: SharedScanRecord[]; total: number }>;
  findSharedForUser(scanId: string, userId: string): Promise<SharedScanRecord | null>;
  findAccessStatus(
    scanId: string,
    userId: string,
  ): Promise<{ revokedAt: Date | null; deletedAt: Date | null } | null>;
  findScanOwner(scanId: string): Promise<string | null>;
  removeFromShared(scanId: string, userId: string, removedAt: Date): Promise<boolean>;
}
