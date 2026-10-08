export interface DiscoveryGender {
  id: string;
  code: string;
  name: string;
}

export interface DiscoveryPhoto {
  id: string;
  url: string;
  displayOrder: number;
  isPrimary: boolean;
}

export interface DiscoveryInterest {
  id: string;
  code: string;
  name: string;
  category: string | null;
}

export interface DiscoveryRelationshipIntention {
  id: string;
  code: string;
  name: string;
}

export interface DiscoveryCandidate {
  id: string;
  firstName: string;
  age: number;
  gender: DiscoveryGender;
  bio: string | null;
  occupation: string | null;
  education: string | null;
  city: string | null;
  distanceKm: number;
  photos: DiscoveryPhoto[];
  interests: DiscoveryInterest[];
  relationshipIntentions: DiscoveryRelationshipIntention[];
}

export interface DiscoveryCard {
  candidate: DiscoveryCandidate | null;
}

export interface ViewerDiscoveryContext {
  isProfileComplete: boolean;
  hasLocation: boolean;
  hasDatingPreferences: boolean;
}
