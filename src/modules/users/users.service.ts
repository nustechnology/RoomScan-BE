import { UserNotFoundError } from './users.errors.js';
import type {
  GetMeResult,
  UpdateMeInput,
  UserProfile,
  UserProfileRepository,
} from './users.types.js';

export interface UserProfileServiceDependencies {
  repository: UserProfileRepository;
}

function toProfile(user: {
  id: string;
  publicUserId: string;
  email: string | null;
  displayName: string | null;
}): UserProfile {
  return {
    id: user.id,
    publicUserId: user.publicUserId,
    email: user.email,
    displayName: user.displayName,
    provider: 'apple',
  };
}

export class UserProfileService {
  readonly #repository: UserProfileRepository;

  constructor({ repository }: UserProfileServiceDependencies) {
    this.#repository = repository;
  }

  async getMe(userId: string): Promise<GetMeResult> {
    const user = await this.#repository.findById(userId);
    if (user === null) {
      throw new UserNotFoundError();
    }
    return {
      publicUserId: user.publicUserId,
      email: user.email,
      displayName: user.displayName,
    };
  }

  async updateMe(userId: string, data: UpdateMeInput): Promise<UserProfile> {
    const user = await this.#repository.updateDisplayName(userId, data.displayName);
    if (user === null) {
      throw new UserNotFoundError();
    }
    return toProfile(user);
  }
}
