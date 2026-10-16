import { Op, Transaction } from 'sequelize';
import '../../database/associations';
import { Plan } from '../../database/models/plan.model';
import { Subscription } from '../../database/models/subscription.model';
import type { QualifyingPremiumSubscription } from './subscriptions.types';

const PREMIUM_PLAN_CODES = ['PREMIUM_MONTHLY', 'PREMIUM_YEARLY'] as const;
const PREMIUM_STATUSES = ['ACTIVE', 'PAST_DUE', 'GRACE_PERIOD'] as const;

export async function findActivePlans(): Promise<Plan[]> {
  return Plan.findAll({
    attributes: ['id', 'code', 'name', 'priceInCents', 'currency', 'billingInterval'],
    where: { isActive: true },
    order: [['displayOrder', 'ASC']]
  });
}

export async function findQualifyingPremiumSubscription(
  userId: string,
  transaction: Transaction
): Promise<QualifyingPremiumSubscription | null> {
  const now = new Date();
  const subscription = await Subscription.findOne({
    attributes: ['status', 'autoRenew', 'currentPeriodStart', 'currentPeriodEnd', 'gracePeriodEnd'],
    where: {
      userId,
      status: { [Op.in]: [...PREMIUM_STATUSES] },
      [Op.or]: [{ currentPeriodEnd: { [Op.gt]: now } }, { gracePeriodEnd: { [Op.gt]: now } }]
    },
    include: [
      {
        model: Plan,
        as: 'plan',
        attributes: ['id', 'code', 'name'],
        required: true,
        where: { code: { [Op.in]: [...PREMIUM_PLAN_CODES] } }
      }
    ],
    transaction
  });
  if (!subscription) {
    return null;
  }

  const plan = subscription.get('plan') as Plan | undefined;
  return {
    status: subscription.status,
    autoRenew: subscription.autoRenew,
    currentPeriodStart: subscription.currentPeriodStart,
    currentPeriodEnd: subscription.currentPeriodEnd,
    gracePeriodEnd: subscription.gracePeriodEnd,
    plan: plan ? { id: plan.id, code: plan.code, name: plan.name } : null
  };
}
