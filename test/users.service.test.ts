import { describe, expect, it, vi } from 'vitest';

import { UserNotFoundError } from '../src/modules/users/users.errors.js';
import { UserProfileService } from '../src/modules/users/users.service.js';
import type { UserProfileRepository } from '../src/modules/users/users.types.js';

const USER_ID = 'eb5d278f-c857-45c7-887d-7be65288cb75';
const PUBLIC_USER_ID = 'GP5HS2WKBE';

describe('UserProfileService', () => {
  it('updates the current user displayName and reports the apple provider', async () => {
    const updateDisplayName = vi
      .fn<UserProfileRepository['updateDisplayName']>()
      .mockResolvedValue({
        id: USER_ID,
        publicUserId: PUBLIC_USER_ID,
        email: 'owner@example.com',
        displayName: 'Nguyen Minh Anh',
      });
    const service = new UserProfileService({
      repository: { findById: vi.fn(), updateDisplayName },
    });

    await expect(service.updateMe(USER_ID, { displayName: 'Nguyen Minh Anh' })).resolves.toEqual({
      id: USER_ID,
      publicUserId: PUBLIC_USER_ID,
      email: 'owner@example.com',
      displayName: 'Nguyen Minh Anh',
      provider: 'apple',
    });
    expect(updateDisplayName).toHaveBeenCalledWith(USER_ID, 'Nguyen Minh Anh');
  });

  it('clears the displayName when null is supplied', async () => {
    const updateDisplayName = vi
      .fn<UserProfileRepository['updateDisplayName']>()
      .mockResolvedValue({
        id: USER_ID,
        publicUserId: PUBLIC_USER_ID,
        email: 'owner@example.com',
        displayName: null,
      });
    const service = new UserProfileService({
      repository: { findById: vi.fn(), updateDisplayName },
    });

    await expect(service.updateMe(USER_ID, { displayName: null })).resolves.toEqual({
      id: USER_ID,
      publicUserId: PUBLIC_USER_ID,
      email: 'owner@example.com',
      displayName: null,
      provider: 'apple',
    });
  });

  it('throws UserNotFoundError when the current user no longer exists', async () => {
    const updateDisplayName = vi
      .fn<UserProfileRepository['updateDisplayName']>()
      .mockResolvedValue(null);
    const service = new UserProfileService({
      repository: { findById: vi.fn(), updateDisplayName },
    });

    await expect(service.updateMe(USER_ID, { displayName: 'A' })).rejects.toBeInstanceOf(
      UserNotFoundError,
    );
  });

  it('returns the email and displayName for the current user', async () => {
    const findById = vi.fn<UserProfileRepository['findById']>().mockResolvedValue({
      id: USER_ID,
      publicUserId: PUBLIC_USER_ID,
      email: 'owner@example.com',
      displayName: 'Nguyen Minh Anh',
    });
    const service = new UserProfileService({
      repository: { findById, updateDisplayName: vi.fn() },
    });

    await expect(service.getMe(USER_ID)).resolves.toEqual({
      publicUserId: PUBLIC_USER_ID,
      email: 'owner@example.com',
      displayName: 'Nguyen Minh Anh',
    });
    expect(findById).toHaveBeenCalledWith(USER_ID);
  });

  it('throws UserNotFoundError when getMe cannot find the user', async () => {
    const findById = vi.fn<UserProfileRepository['findById']>().mockResolvedValue(null);
    const service = new UserProfileService({
      repository: { findById, updateDisplayName: vi.fn() },
    });

    await expect(service.getMe(USER_ID)).rejects.toBeInstanceOf(UserNotFoundError);
  });
});
