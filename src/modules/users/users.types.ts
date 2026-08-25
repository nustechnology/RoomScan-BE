export interface ProfileRecord {
  id: string;
  email: string | null;
  displayName: string | null;
}

export interface UserProfile extends ProfileRecord {
  provider: 'apple';
}

export interface UserProfileRepository {
  updateDisplayName(userId: string, displayName: string | null): Promise<ProfileRecord | null>;
}

export interface UpdateMeInput {
  displayName: string | null;
}

export interface UserProfileService {
  updateMe(userId: string, data: UpdateMeInput): Promise<UserProfile>;
}
