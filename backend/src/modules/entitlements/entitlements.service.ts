import { sequelize } from '../../config/database';
import {
  currentUtcDayWindow,
  DAILY_LIKE_PASS_METRIC,
  DAILY_TEXT_MESSAGES_METRIC,
  hasActivePremium
} from '../likes/likes.data-access';
import { findCurrentDayUsageCounts, findStoredCreditBalances } from './entitlements.data-access';
import type { EntitlementsSnapshot, UsageMetricSnapshot, UsageSnapshot } from './entitlements.types';
import { resolveDailyCatalogLimit, type DailyCatalogLimit } from './usage.service';

export async function getCurrentEntitlements(userId: string): Promise<EntitlementsSnapshot> {
  return sequelize.transaction(async (transaction) => {
    const premium = await hasActivePremium(userId, transaction);
    const credits = await findStoredCreditBalances(userId, transaction);

    return {
      tier: premium ? 'PREMIUM' : 'FREE',
      features: {
        unlimitedSwipes: premium,
        seeWhoLikedYou: premium,
        advancedFilters: false,
        undoAction: premium,
        chatMedia: premium,
        adFree: false,
        priorityVisibility: false
      },
      credits
    };
  });
}

function usageMetric(used: number, catalog: DailyCatalogLimit): UsageMetricSnapshot {
  if (catalog.isUnlimited) {
    return {
      used,
      limit: null,
      remaining: null,
      isUnlimited: true
    };
  }

  return {
    used,
    limit: catalog.limit,
    remaining: catalog.limit - used,
    isUnlimited: false
  };
}

export async function getCurrentUsage(userId: string): Promise<UsageSnapshot> {
  return sequelize.transaction(async (transaction) => {
    const window = currentUtcDayWindow();
    const dailyLikePass = await resolveDailyCatalogLimit(userId, DAILY_LIKE_PASS_METRIC, transaction);
    const dailyTextMessages = await resolveDailyCatalogLimit(userId, DAILY_TEXT_MESSAGES_METRIC, transaction);
    const counts = await findCurrentDayUsageCounts(userId, window.periodStart, transaction);

    return {
      dailyLikePass: usageMetric(counts.likePassUsed, dailyLikePass),
      dailyTextMessages: usageMetric(counts.textMessagesUsed, dailyTextMessages),
      quotaResetsAt: window.periodEnd.toISOString()
    };
  });
}
