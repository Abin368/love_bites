import type { SubscriptionStatus } from '../../database/models/subscription.model';

export type PlanBillingInterval = 'NONE' | 'MONTH' | 'YEAR';

export interface SubscriptionPlanCatalogItem {
  id: string;
  code: string;
  name: string;
  priceInCents: number;
  currency: string;
  billingInterval: PlanBillingInterval;
}

export interface QualifyingPremiumPlanSummary {
  id: string;
  code: string;
  name: string;
}

export interface QualifyingPremiumSubscription {
  status: SubscriptionStatus;
  autoRenew: boolean;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  gracePeriodEnd: Date | null;
  plan: QualifyingPremiumPlanSummary | null;
}

export interface CurrentSubscriptionDetails {
  plan: {
    code: string;
    name: string;
  };
  status: SubscriptionStatus;
  autoRenew: boolean;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  gracePeriodEnd: Date | null;
}

export type CurrentSubscriptionState =
  | {
      hasActiveSubscription: true;
      subscription: CurrentSubscriptionDetails;
    }
  | {
      hasActiveSubscription: false;
      subscription: null;
    };
