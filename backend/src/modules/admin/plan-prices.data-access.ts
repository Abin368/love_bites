import { Transaction } from 'sequelize';
import '../../database/associations';
import { PLAN_PRICE_CHANGE_ACTION, PlanPriceChange } from '../../database/models/plan-price-change.model';
import { Plan } from '../../database/models/plan.model';

export async function lockPlanById(planId: string, transaction: Transaction): Promise<Plan | null> {
  return Plan.findOne({
    where: { id: planId },
    transaction,
    lock: Transaction.LOCK.UPDATE
  });
}

export async function updatePlanPrice(
  plan: Plan,
  priceInCents: number,
  currency: string,
  transaction: Transaction
): Promise<void> {
  await plan.update({ priceInCents, currency }, { transaction });
}

export async function insertPlanPriceChange(
  input: {
    adminUserId: string;
    planId: string;
    oldPriceInCents: number;
    newPriceInCents: number;
    oldCurrency: string;
    newCurrency: string;
    reason: string;
  },
  transaction: Transaction
): Promise<PlanPriceChange> {
  return PlanPriceChange.create(
    {
      adminUserId: input.adminUserId,
      planId: input.planId,
      oldPriceInCents: input.oldPriceInCents,
      newPriceInCents: input.newPriceInCents,
      oldCurrency: input.oldCurrency,
      newCurrency: input.newCurrency,
      action: PLAN_PRICE_CHANGE_ACTION,
      reason: input.reason,
      createdAt: new Date()
    },
    { transaction }
  );
}
