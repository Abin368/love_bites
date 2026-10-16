import { sequelize } from '../../config/database';
import { InternalServerError, NotFoundError } from '../../utils/errors';
import * as subscriptionsDataAccess from './subscriptions.data-access';
import type {
  CancelSubscriptionResult,
  CurrentSubscriptionState,
  SubscriptionPlanCatalogItem
} from './subscriptions.types';

function activeSubscriptionNotFound(): NotFoundError {
  return new NotFoundError('Active subscription not found.', [], 'ACTIVE_SUBSCRIPTION_NOT_FOUND');
}

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

export async function cancelSubscription(userId: string): Promise<CancelSubscriptionResult> {
  return sequelize.transaction(async (transaction) => {
    const now = new Date();
    const current = await subscriptionsDataAccess.lockNonterminalSubscription(userId, transaction);
    if (current?.status === 'ACTIVE') {
      await subscriptionsDataAccess.cancelActiveSubscription(current, now, transaction);
      return { autoRenew: false, activeUntil: current.currentPeriodEnd };
    }
    if (current) {
      throw activeSubscriptionNotFound();
    }

    const canceled = await subscriptionsDataAccess.findInPeriodCanceledSubscription(userId, now, transaction);
    if (!canceled) {
      throw activeSubscriptionNotFound();
    }

    return { autoRenew: false, activeUntil: canceled.currentPeriodEnd };
  });
}
