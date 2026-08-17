import type { SyncResourceType } from '../../modules/sync/sync.types.js';

export class RevisionRequiredError extends Error {
  constructor() {
    super('If-Match revision is required');
    this.name = 'RevisionRequiredError';
  }
}

export class InvalidRevisionError extends Error {
  constructor() {
    super('If-Match revision is invalid');
    this.name = 'InvalidRevisionError';
  }
}

export class RevisionConflictError extends Error {
  readonly projectId: string;
  readonly resourceType: SyncResourceType;
  readonly resourceId: string;
  readonly currentRevision: number;
  readonly deleted: boolean;

  constructor(input: {
    projectId: string;
    resourceType: SyncResourceType;
    resourceId: string;
    currentRevision: number;
    deleted: boolean;
  }) {
    super('The resource revision is stale');
    this.name = 'RevisionConflictError';
    this.projectId = input.projectId;
    this.resourceType = input.resourceType;
    this.resourceId = input.resourceId;
    this.currentRevision = input.currentRevision;
    this.deleted = input.deleted;
  }
}
