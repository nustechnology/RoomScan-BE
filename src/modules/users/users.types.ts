export interface ProfileRecord {
  id: string;
  publicUserId: string;
  email: string | null;
  displayName: string | null;
}

export interface UserProfile extends ProfileRecord {
  provider: 'apple';
}

export interface UserProfileRepository {
  findById(userId: string): Promise<ProfileRecord | null>;
  updateDisplayName(userId: string, displayName: string | null): Promise<ProfileRecord | null>;
}

export interface UpdateMeInput {
  displayName: string | null;
}

export interface GetMeResult {
  publicUserId: string;
  email: string | null;
  displayName: string | null;
}

export interface UserProfileService {
  getMe(userId: string): Promise<GetMeResult>;
  updateMe(userId: string, data: UpdateMeInput): Promise<UserProfile>;
}
