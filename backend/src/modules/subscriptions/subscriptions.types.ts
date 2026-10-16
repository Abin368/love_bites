export type PlanBillingInterval = 'NONE' | 'MONTH' | 'YEAR';

export interface SubscriptionPlanCatalogItem {
  id: string;
  code: string;
  name: string;
  priceInCents: number;
  currency: string;
  billingInterval: PlanBillingInterval;
}
