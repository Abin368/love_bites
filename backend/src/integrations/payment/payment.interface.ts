export interface CreatePaymentOrderInput {
  amountInCents: number;
  currency: 'INR';
  receipt: string;
  paymentId: string;
}

export interface CreatedPaymentOrder {
  providerOrderId: string;
}

export interface PaymentOrderProvider {
  isConfigured(): boolean;
  publicKeyId(): string;
  createOrder(input: CreatePaymentOrderInput): Promise<CreatedPaymentOrder>;
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
