import Razorpay from 'razorpay';
import { env } from '../../config/env';
import { InternalServerError } from '../../utils/errors';
import {
  PaymentProviderOutcomeUnknownError,
  PaymentProviderRejectedError,
  type CreatedPaymentOrder,
  type CreatePaymentOrderInput,
  type PaymentOrderProvider
} from './payment.interface';

const ORDER_REQUEST_TIMEOUT_MS = 15_000;
const RECEIPT_MAX_LENGTH = 40;
const NOTE_VALUE_MAX_LENGTH = 256;

interface RazorpayOrderClient {
  orders: {
    create(params: {
      amount: number;
      currency: string;
      receipt: string;
      notes: Record<string, string>;
    }): Promise<{ id?: string }>;
  };
}

export function classifyRazorpayFailure(error: unknown): 'rejected' | 'unknown' {
  const statusCode = readStatusCode(error);
  if (statusCode !== undefined && statusCode >= 400 && statusCode < 500 && statusCode !== 408 && statusCode !== 429) {
    return 'rejected';
  }
  return 'unknown';
}

function readStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  if (typeof statusCode === 'number' && Number.isInteger(statusCode)) {
    return statusCode;
  }
  if (typeof statusCode === 'string' && /^[0-9]+$/.test(statusCode)) {
    return Number(statusCode);
  }
  return undefined;
}

function providerNotConfigured(): InternalServerError {
  return new InternalServerError('Payment provider is not configured.', [], 'PAYMENT_NOT_CONFIGURED', true);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('timeout');
      (error as { code?: string }).code = 'ETIMEDOUT';
      reject(error);
    }, timeoutMs);
  });
  // A timed-out request may still settle. Swallow that settlement so it cannot surface as unhandled.
  promise.then(
    () => undefined,
    () => undefined
  );
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

export async function createOrderWithClient(
  client: RazorpayOrderClient,
  input: CreatePaymentOrderInput,
  timeoutMs = ORDER_REQUEST_TIMEOUT_MS
): Promise<CreatedPaymentOrder> {
  if (
    input.currency !== 'INR' ||
    !Number.isInteger(input.amountInCents) ||
    input.amountInCents <= 0 ||
    input.receipt.length < 1 ||
    input.receipt.length > RECEIPT_MAX_LENGTH ||
    input.paymentId.length < 1 ||
    input.paymentId.length > NOTE_VALUE_MAX_LENGTH ||
    input.receipt !== input.paymentId
  ) {
    throw new PaymentProviderRejectedError();
  }

  try {
    const order = await withTimeout(
      client.orders.create({
        amount: input.amountInCents,
        currency: 'INR',
        receipt: input.receipt,
        notes: { paymentId: input.paymentId }
      }),
      timeoutMs
    );
    if (!order || typeof order.id !== 'string' || order.id.length === 0) {
      throw new PaymentProviderOutcomeUnknownError();
    }
    return { providerOrderId: order.id };
  } catch (error) {
    if (error instanceof PaymentProviderOutcomeUnknownError || error instanceof PaymentProviderRejectedError) {
      throw error;
    }
    if (classifyRazorpayFailure(error) === 'rejected') {
      throw new PaymentProviderRejectedError();
    }
    throw new PaymentProviderOutcomeUnknownError();
  }
}

function razorpayClient(): RazorpayOrderClient {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    throw providerNotConfigured();
  }
  return new Razorpay({
    key_id: env.RAZORPAY_KEY_ID,
    key_secret: env.RAZORPAY_KEY_SECRET
  });
}

export const razorpayOrderProvider: PaymentOrderProvider = {
  isConfigured(): boolean {
    return Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
  },

  publicKeyId(): string {
    if (!env.RAZORPAY_KEY_ID) {
      throw providerNotConfigured();
    }
    return env.RAZORPAY_KEY_ID;
  },

  createOrder(input: CreatePaymentOrderInput): Promise<CreatedPaymentOrder> {
    return createOrderWithClient(razorpayClient(), input);
  }
};
