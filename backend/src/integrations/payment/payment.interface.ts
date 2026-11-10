export interface CreatePaymentOrderInput {
  amountInCents: number;
  currency: 'INR';
  receipt: string;
  paymentId: string;
}

export interface CreatedPaymentOrder {
  providerOrderId: string;
}

export interface VerifyOrderSignatureInput {
  storedOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

export interface ListedProviderOrder {
  providerOrderId: string;
  receipt: string | null;
  amountInCents: number | null;
  currency: string | null;
  notesPaymentId: string | null;
}

export interface ListOrdersInWindowInput {
  from: number;
  to: number;
}

export type OrderWindowLookup =
  | { kind: 'complete'; orders: ListedProviderOrder[] }
  | { kind: 'incomplete' }
  | { kind: 'malformed' };

export interface PaymentOrderProvider {
  isConfigured(): boolean;
  isVerificationConfigured(): boolean;
  publicKeyId(): string;
  createOrder(input: CreatePaymentOrderInput): Promise<CreatedPaymentOrder>;
  listOrdersInWindow(input: ListOrdersInWindowInput): Promise<OrderWindowLookup>;
  verifyOrderSignature(input: VerifyOrderSignatureInput): boolean;
}

export class PaymentProviderRejectedError extends Error {
  constructor() {
    super('Payment provider rejected the order.');
    this.name = 'PaymentProviderRejectedError';
  }
}

export class PaymentProviderOutcomeUnknownError extends Error {
  constructor() {
    super('Payment provider outcome is unknown.');
    this.name = 'PaymentProviderOutcomeUnknownError';
  }
}
