import { asyncHandler } from '../../utils/async-handler';
import * as paymentsService from './payments.service';
import { parseIdempotencyKey, type CheckoutBody } from './payments.validator';

export const createCheckout = asyncHandler(async (req, res) => {
  const body = req.body as CheckoutBody;
  const result = await paymentsService.createCheckout({
    userId: req.user!.id,
    planId: body.planId,
    idempotencyKey: parseIdempotencyKey(req.get('Idempotency-Key'))
  });

  res.status(200).json({
    success: true,
    data: result,
    message: 'Checkout initiated.'
  });
});
