export interface UpdatePlanPriceInput {
  adminUserId: string;
  planId: string;
  priceInCents?: number;
  currency?: 'INR';
  reason: string;
}

export interface PlanPriceView {
  id: string;
  code: string;
  priceInCents: number;
  currency: string;
  isActive: boolean;
  updatedAt: Date;
}

export interface UpdatePlanPriceResult {
  changed: boolean;
  plan: PlanPriceView;
}
