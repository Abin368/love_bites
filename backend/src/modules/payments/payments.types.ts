export interface CheckoutInput {
  userId: string;
  planId: string;
  idempotencyKey: string;
}

export interface CheckoutResult {
  paymentId: string;
  planId: string;
  planCode: string;
  orderId: string;
  amountInCents: number;
  currency: string;
  keyId: string;
}

export interface VerifyPaymentInput {
  userId: string;
  razorpayPaymentId: string;
  razorpayOrderId: string;
  razorpaySignature: string;
}
