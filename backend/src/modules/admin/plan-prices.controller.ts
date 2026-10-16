import { asyncHandler } from '../../utils/async-handler';
import * as planPricesService from './plan-prices.service';
import { parsePlanId, type UpdatePlanPriceBody } from './plan-prices.validator';

export const updatePlanPrice = asyncHandler(async (req, res) => {
  const body = req.body as UpdatePlanPriceBody;
  const rawPlanId = req.params.planId;
  const planId = parsePlanId(Array.isArray(rawPlanId) ? rawPlanId[0] : rawPlanId);
  const result = await planPricesService.updatePlanPrice({
    adminUserId: req.user!.id,
    planId,
    priceInCents: body.priceInCents,
    currency: body.currency,
    reason: body.reason
  });

  res.status(200).json({
    success: true,
    data: result.plan,
    message: result.changed ? 'Plan price updated.' : 'Plan price is unchanged.'
  });
});
