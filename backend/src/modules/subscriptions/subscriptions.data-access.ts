import { Op, Transaction } from 'sequelize';
import '../../database/associations';
import { Plan } from '../../database/models/plan.model';
import { Subscription } from '../../database/models/subscription.model';
import type { QualifyingPremiumSubscription } from './subscriptions.types';

const PREMIUM_PLAN_CODES = ['PREMIUM_MONTHLY', 'PREMIUM_YEARLY'] as const;
const NONTERMINAL_STATUSES = ['ACTIVE', 'PAST_DUE', 'GRACE_PERIOD'] as const;
const QUALIFYING_ATTRIBUTES = [
  'id',
  'status',
  'autoRenew',
  'currentPeriodStart',
  'currentPeriodEnd',
  'gracePeriodEnd',
  'updatedAt'
] as const;

const premiumPlanInclude = {
  model: Plan,
  as: 'plan' as const,
  attributes: ['id', 'code', 'name'],
  required: true,
  where: { code: { [Op.in]: [...PREMIUM_PLAN_CODES] } }
};

function toQualifyingPremiumSubscription(subscription: Subscription): QualifyingPremiumSubscription {
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

export async function findActivePlans(): Promise<Plan[]> {
  return Plan.findAll({
    attributes: ['id', 'code', 'name', 'priceInCents', 'currency', 'billingInterval'],
    where: { isActive: true },
    order: [['displayOrder', 'ASC']]
  });
}

export async function findQualifyingPremiumSubscription(
  userId: string,
  transaction: Transaction,
  now: Date = new Date()
): Promise<QualifyingPremiumSubscription | null> {
  const nonCanceled = await Subscription.findOne({
    attributes: [...QUALIFYING_ATTRIBUTES],
    where: {
      userId,
      status: { [Op.in]: [...NONTERMINAL_STATUSES] },
      [Op.or]: [{ currentPeriodEnd: { [Op.gt]: now } }, { gracePeriodEnd: { [Op.gt]: now } }]
    },
    include: [premiumPlanInclude],
    subQuery: false,
    transaction
  });
  if (nonCanceled) {
    return toQualifyingPremiumSubscription(nonCanceled);
  }

  const canceled = await Subscription.findOne({
    attributes: [...QUALIFYING_ATTRIBUTES],
    where: {
      userId,
      status: 'CANCELED',
      currentPeriodEnd: { [Op.gt]: now }
    },
    include: [premiumPlanInclude],
    order: [
      ['currentPeriodEnd', 'DESC'],
      ['updatedAt', 'DESC'],
      ['id', 'DESC']
    ],
    subQuery: false,
    transaction
  });
  if (!canceled) {
    return null;
  }

  return toQualifyingPremiumSubscription(canceled);
}

export async function lockNonterminalSubscription(
  userId: string,
  transaction: Transaction
): Promise<Subscription | null> {
  return Subscription.findOne({
    where: {
      userId,
      status: { [Op.in]: [...NONTERMINAL_STATUSES] }
    },
    transaction,
    lock: Transaction.LOCK.UPDATE
  });
}

export async function expireElapsedNonterminalSubscription(
  userId: string,
  now: Date,
  transaction: Transaction
): Promise<number> {
  const [count] = await Subscription.update(
    {
      status: 'EXPIRED',
      endedAt: now
    },
    {
      where: {
        userId,
        status: { [Op.in]: [...NONTERMINAL_STATUSES] },
        currentPeriodEnd: { [Op.lte]: now },
        [Op.or]: [{ gracePeriodEnd: { [Op.is]: null } }, { gracePeriodEnd: { [Op.lte]: now } }]
      },
      transaction
    }
  );
  return count;
}

export async function cancelActiveSubscription(
  subscription: Subscription,
  canceledAt: Date,
  transaction: Transaction
): Promise<void> {
  await subscription.update(
    {
      status: 'CANCELED',
      autoRenew: false,
      canceledAt
    },
    { transaction }
  );
}

export async function insertActivePremiumSubscription(
  input: {
    userId: string;
    planId: string;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
  },
  transaction: Transaction
): Promise<Subscription> {
  return Subscription.create(
    {
      userId: input.userId,
      planId: input.planId,
      provider: 'RAZORPAY',
      providerSubscriptionId: null,
      providerCustomerId: null,
      status: 'ACTIVE',
      autoRenew: false,
      currentPeriodStart: input.currentPeriodStart,
      currentPeriodEnd: input.currentPeriodEnd,
      gracePeriodEnd: null,
      canceledAt: null,
      endedAt: null,
      createdAt: input.currentPeriodStart,
      updatedAt: input.currentPeriodStart
    },
    { transaction }
  );
}

export async function findInPeriodCanceledSubscription(
  userId: string,
  now: Date,
  transaction: Transaction
): Promise<Subscription | null> {
  return Subscription.findOne({
    where: {
      userId,
      status: 'CANCELED',
      currentPeriodEnd: { [Op.gt]: now }
    },
    order: [
      ['currentPeriodEnd', 'DESC'],
      ['updatedAt', 'DESC'],
      ['id', 'DESC']
    ],
    transaction,
    lock: Transaction.LOCK.UPDATE
  });
}
