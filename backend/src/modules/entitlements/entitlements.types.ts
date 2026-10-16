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

export interface UsageMetricSnapshot {
  used: number;
  limit: number | null;
  remaining: number | null;
  isUnlimited: boolean;
}

export interface UsageSnapshot {
  dailyLikePass: UsageMetricSnapshot;
  dailyTextMessages: UsageMetricSnapshot;
  quotaResetsAt: string;
}

export interface CurrentDayUsageCounts {
  likePassUsed: number;
  textMessagesUsed: number;
}
