import { sequelize } from '../../config/database';
import type { Plan } from '../../database/models/plan.model';
import { NotFoundError, ValidationError } from '../../utils/errors';
import * as planPricesDataAccess from './plan-prices.data-access';
import type { PlanPriceView, UpdatePlanPriceInput, UpdatePlanPriceResult } from './plan-prices.types';

const PREMIUM_PLAN_CODES = new Set(['PREMIUM_MONTHLY', 'PREMIUM_YEARLY']);
const SUPPORTED_CURRENCY = 'INR';
const PRICE_MAX = 2_147_483_647;

function priceValidation(message: string, field: 'priceInCents' | 'currency'): ValidationError {
  return new ValidationError('Validation failed', [{ field, message }]);
}

function assertResultingPrice(code: string, priceInCents: number, currency: string): void {
  if (!Number.isInteger(priceInCents) || priceInCents < 0 || priceInCents > PRICE_MAX) {
    throw priceValidation('Price must be an integer number of cents.', 'priceInCents');
  }
  if (currency !== SUPPORTED_CURRENCY) {
    throw priceValidation('Currency must be INR.', 'currency');
  }
  if (PREMIUM_PLAN_CODES.has(code) && priceInCents <= 0) {
    throw priceValidation('Premium plans must have a price greater than zero.', 'priceInCents');
  }
}

function toView(plan: Plan): PlanPriceView {
  return {
    id: plan.id,
    code: plan.code,
    priceInCents: plan.priceInCents,
    currency: plan.currency,
    isActive: plan.isActive,
    updatedAt: plan.updatedAt
  };
}

export async function updatePlanPrice(input: UpdatePlanPriceInput): Promise<UpdatePlanPriceResult> {
  return sequelize.transaction(async (transaction) => {
    const plan = await planPricesDataAccess.lockPlanById(input.planId, transaction);
    if (!plan) {
      throw new NotFoundError('Resource not found', [], 'RESOURCE_NOT_FOUND');
    }

    const priceInCents = input.priceInCents ?? plan.priceInCents;
    const currency = input.currency ?? plan.currency;
    assertResultingPrice(plan.code, priceInCents, currency);

    if (priceInCents === plan.priceInCents && currency === plan.currency) {
      return { changed: false, plan: toView(plan) };
    }

    const oldPriceInCents = plan.priceInCents;
    const oldCurrency = plan.currency;
    await planPricesDataAccess.updatePlanPrice(plan, priceInCents, currency, transaction);
    await planPricesDataAccess.insertPlanPriceChange(
      {
        adminUserId: input.adminUserId,
        planId: plan.id,
        oldPriceInCents,
        newPriceInCents: priceInCents,
        oldCurrency,
        newCurrency: currency,
        reason: input.reason
      },
      transaction
    );

    return { changed: true, plan: toView(plan) };
  });
}
