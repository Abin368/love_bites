import { sequelize } from '../../config/database';
import { InternalServerError } from '../../utils/errors';
import * as subscriptionsDataAccess from './subscriptions.data-access';
import type { CurrentSubscriptionState, SubscriptionPlanCatalogItem } from './subscriptions.types';

export async function listActivePlans(): Promise<SubscriptionPlanCatalogItem[]> {
  const rows = await subscriptionsDataAccess.findActivePlans();
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    priceInCents: row.priceInCents,
    currency: row.currency,
    billingInterval: row.billingInterval
  }));
}

export async function getCurrentSubscription(userId: string): Promise<CurrentSubscriptionState> {
  return sequelize.transaction(async (transaction) => {
    const row = await subscriptionsDataAccess.findQualifyingPremiumSubscription(userId, transaction);
    if (!row) {
      return { hasActiveSubscription: false, subscription: null };
    }
    if (!row.plan) {
      throw new InternalServerError('Internal server error', [], 'INTERNAL_SERVER_ERROR', true);
    }

    return {
      hasActiveSubscription: true,
      subscription: {
        plan: {
          code: row.plan.code,
          name: row.plan.name
        },
        status: row.status,
        autoRenew: row.autoRenew,
        currentPeriodStart: row.currentPeriodStart,
        currentPeriodEnd: row.currentPeriodEnd,
        gracePeriodEnd: row.gracePeriodEnd
      }
    };
  });
}
