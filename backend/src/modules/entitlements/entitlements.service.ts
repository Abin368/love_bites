import { sequelize } from '../../config/database';
import {
  currentUtcDayWindow,
  FREE_DAILY_LIKE_PASS_LIMIT,
  FREE_DAILY_TEXT_MESSAGES_LIMIT,
  hasActivePremium
} from '../likes/likes.data-access';
import { findCurrentDayUsageCounts, findStoredCreditBalances } from './entitlements.data-access';
import type { EntitlementsSnapshot, UsageMetricSnapshot, UsageSnapshot } from './entitlements.types';

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

function usageMetric(used: number, limit: number, unlimited: boolean): UsageMetricSnapshot {
  if (unlimited) {
    return {
      used,
      limit: null,
      remaining: null,
      isUnlimited: true
    };
  }

  return {
    used,
    limit,
    remaining: limit - used,
    isUnlimited: false
  };
}

export async function getCurrentUsage(userId: string): Promise<UsageSnapshot> {
  return sequelize.transaction(async (transaction) => {
    const window = currentUtcDayWindow();
    const premium = await hasActivePremium(userId, transaction);
    const counts = await findCurrentDayUsageCounts(userId, window.periodStart, transaction);

    return {
      dailyLikePass: usageMetric(counts.likePassUsed, FREE_DAILY_LIKE_PASS_LIMIT, premium),
      dailyTextMessages: usageMetric(counts.textMessagesUsed, FREE_DAILY_TEXT_MESSAGES_LIMIT, premium),
      quotaResetsAt: window.periodEnd.toISOString()
    };
  });
}
