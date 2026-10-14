import { sequelize } from '../../config/database';
import { hasActivePremium } from '../likes/likes.data-access';
import { findStoredCreditBalances } from './entitlements.data-access';
import type { EntitlementsSnapshot } from './entitlements.types';

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
