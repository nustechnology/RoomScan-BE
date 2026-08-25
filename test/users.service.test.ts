import { describe, expect, it, vi } from 'vitest';

import { UserNotFoundError } from '../src/modules/users/users.errors.js';
import { UserProfileService } from '../src/modules/users/users.service.js';
import type { UserProfileRepository } from '../src/modules/users/users.types.js';

const USER_ID = 'eb5d278f-c857-45c7-887d-7be65288cb75';

describe('UserProfileService', () => {
  it('updates the current user displayName and reports the apple provider', async () => {
    const updateDisplayName = vi
      .fn<UserProfileRepository['updateDisplayName']>()
      .mockResolvedValue({
        id: USER_ID,
        email: 'owner@example.com',
        displayName: 'Nguyen Minh Anh',
      });
    const service = new UserProfileService({ repository: { updateDisplayName } });

    await expect(service.updateMe(USER_ID, { displayName: 'Nguyen Minh Anh' })).resolves.toEqual({
      id: USER_ID,
      email: 'owner@example.com',
      displayName: 'Nguyen Minh Anh',
      provider: 'apple',
    });
    expect(updateDisplayName).toHaveBeenCalledWith(USER_ID, 'Nguyen Minh Anh');
  });

  it('clears the displayName when null is supplied', async () => {
    const updateDisplayName = vi
      .fn<UserProfileRepository['updateDisplayName']>()
      .mockResolvedValue({ id: USER_ID, email: 'owner@example.com', displayName: null });
    const service = new UserProfileService({ repository: { updateDisplayName } });

    await expect(service.updateMe(USER_ID, { displayName: null })).resolves.toEqual({
      id: USER_ID,
      email: 'owner@example.com',
      displayName: null,
      provider: 'apple',
    });
  });

  it('throws UserNotFoundError when the current user no longer exists', async () => {
    const updateDisplayName = vi
      .fn<UserProfileRepository['updateDisplayName']>()
      .mockResolvedValue(null);
    const service = new UserProfileService({ repository: { updateDisplayName } });

    await expect(service.updateMe(USER_ID, { displayName: 'A' })).rejects.toBeInstanceOf(
      UserNotFoundError,
    );
  });
});
