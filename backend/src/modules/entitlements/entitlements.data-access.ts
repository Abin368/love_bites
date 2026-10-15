import { Op, Transaction } from 'sequelize';
import '../../database/associations';
import { Plan } from '../../database/models/plan.model';
import { UsageLimit } from '../../database/models/usage-limit.model';
import { UsageRecord } from '../../database/models/usage-record.model';
import { UserCreditBalance } from '../../database/models/user-credit-balance.model';
import { DAILY_LIKE_PASS_METRIC, DAILY_TEXT_MESSAGES_METRIC } from '../likes/likes.data-access';
import type { CurrentDayUsageCounts, StoredCreditBalances } from './entitlements.types';

const SUPER_LIKE_CREDIT = 'SUPER_LIKE';
const BOOST_CREDIT = 'BOOST';

export async function findPlanByCode(code: string, transaction: Transaction): Promise<Plan | null> {
  return Plan.findOne({
    where: { code },
    transaction
  });
}

export async function findUsageLimit(
  planId: string,
  metricKey: string,
  transaction: Transaction
): Promise<UsageLimit | null> {
  return UsageLimit.findOne({
    where: { planId, metricKey },
    transaction
  });
}

export async function findStoredCreditBalances(
  userId: string,
  transaction: Transaction
): Promise<StoredCreditBalances> {
  const rows = await UserCreditBalance.findAll({
    attributes: ['creditType', 'balance'],
    where: {
      userId,
      creditType: { [Op.in]: [SUPER_LIKE_CREDIT, BOOST_CREDIT] }
    },
    transaction
  });

  const balances: StoredCreditBalances = {
    boostBalance: 0,
    superLikeBalance: 0
  };

  for (const row of rows) {
    const balance = Number(row.balance);
    if (row.creditType === SUPER_LIKE_CREDIT) {
      balances.superLikeBalance = balance;
    } else if (row.creditType === BOOST_CREDIT) {
      balances.boostBalance = balance;
    }
  }

  return balances;
}

export async function findCurrentDayUsageCounts(
  userId: string,
  periodStart: Date,
  transaction: Transaction
): Promise<CurrentDayUsageCounts> {
  const rows = await UsageRecord.findAll({
    attributes: ['metricKey', 'usageCount'],
    where: {
      userId,
      periodStart,
      metricKey: { [Op.in]: [DAILY_LIKE_PASS_METRIC, DAILY_TEXT_MESSAGES_METRIC] }
    },
    transaction
  });

  const counts: CurrentDayUsageCounts = {
    likePassUsed: 0,
    textMessagesUsed: 0
  };

  for (const row of rows) {
    const usageCount = Number(row.usageCount);
    if (row.metricKey === DAILY_LIKE_PASS_METRIC) {
      counts.likePassUsed = usageCount;
    } else if (row.metricKey === DAILY_TEXT_MESSAGES_METRIC) {
      counts.textMessagesUsed = usageCount;
    }
  }

  return counts;
}
