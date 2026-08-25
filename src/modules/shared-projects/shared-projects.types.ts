import type {
  ProjectScanSummary,
  ProjectScanSummaryResult,
  ProjectSort,
} from '../project/project.types.js';

export type SharedProjectStatus =
  'ACTIVE' | 'REVOKED' | 'PROJECT_DELETED' | 'TEMPORARILY_UNAVAILABLE';

export interface SharedProjectRecord {
  id: string;
  name: string;
  description: string | null;
  owner: {
    id: string;
    email: string | null;
    displayName: string | null;
  };
  scanCount: number;
  thumbnail: string | null;
  updatedAt: Date;
  projectDeletedAt: Date | null;
  accessRevokedAt: Date | null;
  accessDeletedAt: Date | null;
}

export interface SharedProjectResult {
  id: string;
  name: string;
  description: string | null;
  owner: {
    id: string;
    email: string | null;
    displayName: string | null;
  };
  scanCount: number;
  thumbnail: string | null;
  updatedAt: string;
  status: SharedProjectStatus;
  permissions: {
    role: 'VIEWER';
    canView: boolean;
    canEdit: false;
    canDelete: false;
    canShare: false;
    canCreateScan: false;
  };
}

export interface SharedProjectDetailRecord extends SharedProjectRecord {
  scans: ProjectScanSummary[];
}

export interface SharedProjectDetailResult extends SharedProjectResult {
  scans: ProjectScanSummaryResult[];
}

export interface SharedProjectsListOptions {
  search?: string;
  page: number;
  limit: number;
  sort: ProjectSort;
}

export interface SharedProjectsListResult {
  items: SharedProjectResult[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface SharedProjectRemoveResult {
  projectId: string;
  removedAt: string;
}

export interface SharedProjectsRepository {
  list(
    userId: string,
    options: SharedProjectsListOptions,
  ): Promise<{ items: SharedProjectRecord[]; total: number }>;
  findSharedForUser(projectId: string, userId: string): Promise<SharedProjectDetailRecord | null>;
  findAccessStatus(
    projectId: string,
    userId: string,
  ): Promise<{ revokedAt: Date | null; deletedAt: Date | null } | null>;
  findProjectOwner(projectId: string): Promise<string | null>;
  removeFromShared(
    projectId: string,
    userId: string,
    removedAt: Date,
  ): Promise<{ removedAt: Date } | null>;
}
