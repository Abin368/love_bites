import { asyncHandler } from '../../utils/async-handler';
import * as paymentsService from './payments.service';
import { parseIdempotencyKey, type CheckoutBody, type VerifyBody } from './payments.validator';

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

export const verifyPayment = asyncHandler(async (req, res) => {
  const body = req.body as VerifyBody;
  await paymentsService.verifyPayment({
    userId: req.user!.id,
    razorpayPaymentId: body.razorpayPaymentId,
    razorpayOrderId: body.razorpayOrderId,
    razorpaySignature: body.razorpaySignature
  });

  res.status(200).json({
    success: true,
    data: null,
    message: 'Payment signature verified.'
  });
});
