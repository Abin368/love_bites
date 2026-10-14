export type EntitlementTier = 'PREMIUM' | 'FREE';

export interface EntitlementFeatures {
  unlimitedSwipes: boolean;
  seeWhoLikedYou: boolean;
  advancedFilters: boolean;
  undoAction: boolean;
  chatMedia: boolean;
  adFree: boolean;
  priorityVisibility: boolean;
}

export interface EntitlementCredits {
  boostBalance: number;
  superLikeBalance: number;
}

export interface EntitlementsSnapshot {
  tier: EntitlementTier;
  features: EntitlementFeatures;
  credits: EntitlementCredits;
}

export interface StoredCreditBalances {
  boostBalance: number;
  superLikeBalance: number;
}
