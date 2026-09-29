export interface ProfileGender {
  id: string;
  code: string;
  name: string;
}

export interface ProfileResponse {
  id: string;
  userId: string;
  firstName: string;
  dateOfBirth: string;
  gender: ProfileGender;
  bio: string | null;
  occupation: string | null;
  education: string | null;
  city: string | null;
  isProfileComplete: boolean;
}

export interface ProfileCompletionInput {
  city: string | null;
  location: unknown | null;
  activePhotoCount: number;
  hasPrimaryPhoto: boolean;
  interestCount: number;
  intentionCount: number;
  hasDatingPreferences: boolean;
}
