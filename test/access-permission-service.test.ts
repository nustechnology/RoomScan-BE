import { describe, expect, it, vi } from 'vitest';

import { AccessPermissionService } from '../src/common/permissions/access-permission-service.js';

type Role = 'OWNER' | 'VIEWER';

function createNotFoundError() {
  return new Error('NOT_FOUND');
}

describe('AccessPermissionService', () => {
  describe('requireView', () => {
    it('returns the role when access exists', async () => {
      const repository = { findAccessRole: vi.fn().mockResolvedValue('VIEWER' satisfies Role) };
      const service = new AccessPermissionService<Role>(repository, createNotFoundError, 'OWNER');

      await expect(service.requireView('resource-1', 'user-1')).resolves.toBe('VIEWER');
      expect(repository.findAccessRole).toHaveBeenCalledWith('resource-1', 'user-1');
    });

    it('throws the not-found error when access is null', async () => {
      const repository = { findAccessRole: vi.fn().mockResolvedValue(null) };
      const service = new AccessPermissionService<Role>(repository, createNotFoundError, 'OWNER');

      await expect(service.requireView('resource-1', 'user-1')).rejects.toThrow('NOT_FOUND');
    });
  });

  describe('requireOwner', () => {
    it('resolves when the caller has the owner role', async () => {
      const repository = { findAccessRole: vi.fn().mockResolvedValue('OWNER' satisfies Role) };
      const service = new AccessPermissionService<Role>(repository, createNotFoundError, 'OWNER');

      await expect(service.requireOwner('resource-1', 'user-1')).resolves.toBeUndefined();
    });

    it('throws the not-found error when the caller is a viewer, not the owner', async () => {
      const repository = { findAccessRole: vi.fn().mockResolvedValue('VIEWER' satisfies Role) };
      const service = new AccessPermissionService<Role>(repository, createNotFoundError, 'OWNER');

      await expect(service.requireOwner('resource-1', 'user-1')).rejects.toThrow('NOT_FOUND');
    });

    it('throws the not-found error when access does not exist at all', async () => {
      const repository = { findAccessRole: vi.fn().mockResolvedValue(null) };
      const service = new AccessPermissionService<Role>(repository, createNotFoundError, 'OWNER');

      await expect(service.requireOwner('resource-1', 'user-1')).rejects.toThrow('NOT_FOUND');
    });
  });
});
