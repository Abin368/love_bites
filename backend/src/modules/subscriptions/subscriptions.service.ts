import * as subscriptionsDataAccess from './subscriptions.data-access';
import type { SubscriptionPlanCatalogItem } from './subscriptions.types';

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
