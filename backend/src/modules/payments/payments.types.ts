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
