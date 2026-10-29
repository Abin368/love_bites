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

export type OrderReceiptLookup =
  | { kind: 'complete'; orders: ListedProviderOrder[] }
  | { kind: 'incomplete' }
  | { kind: 'malformed' };

export interface PaymentOrderProvider {
  isConfigured(): boolean;
  isVerificationConfigured(): boolean;
  publicKeyId(): string;
  createOrder(input: CreatePaymentOrderInput): Promise<CreatedPaymentOrder>;
  listOrdersByReceipt(receipt: string): Promise<OrderReceiptLookup>;
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
