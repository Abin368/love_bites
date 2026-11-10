import { createHmac } from 'crypto';
import Razorpay from 'razorpay';
import { env } from '../../config/env';
import { safeEqualHex } from '../../utils/crypto';
import { InternalServerError } from '../../utils/errors';
import {
  PaymentProviderOutcomeUnknownError,
  PaymentProviderRejectedError,
  type CreatedPaymentOrder,
  type CreatePaymentOrderInput,
  type ListedProviderOrder,
  type ListOrdersInWindowInput,
  type OrderWindowLookup,
  type PaymentOrderProvider,
  type VerifyOrderSignatureInput
} from './payment.interface';

const ORDER_REQUEST_TIMEOUT_MS = 15_000;
const RECEIPT_MAX_LENGTH = 40;
const NOTE_VALUE_MAX_LENGTH = 256;
const ORDER_ID_MAX_LENGTH = 255;
const CURRENCY_MAX_LENGTH = 3;
export const ORDER_WINDOW_LOOKUP_PAGE_SIZE = 100;
const MAX_LISTING_UNIX_SECONDS = 100_000_000_000;

interface RazorpayOrderClient {
  orders: {
    create(params: {
      amount: number;
      currency: string;
      receipt: string;
      notes: Record<string, string>;
    }): Promise<{ id?: string }>;
    all(params: { from: number; to: number; count: number; skip: number }): Promise<unknown>;
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

export function verificationNotConfigured(): InternalServerError {
  return new InternalServerError(
    'Payment verification is not configured.',
    [],
    'PAYMENT_VERIFICATION_NOT_CONFIGURED',
    true
  );
}

export function verifyWebhookSignature(rawBody: Buffer, signature: string, secret: string): boolean {
  if (secret.length === 0 || signature.length === 0 || rawBody.length === 0) {
    return false;
  }

  const digest = createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqualHex(digest, signature);
}

export function verifyOrderPaymentSignature(
  storedOrderId: string,
  razorpayPaymentId: string,
  razorpaySignature: string,
  secret: string
): boolean {
  if (secret.length === 0 || storedOrderId.length === 0 || razorpayPaymentId.length === 0) {
    return false;
  }

  const digest = createHmac('sha256', secret)
    .update(`${storedOrderId}|${razorpayPaymentId}`, 'utf8')
    .digest('hex');
  return safeEqualHex(digest, razorpaySignature);
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

function readBoundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    return null;
  }
  return value;
}

function readAmount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

function readNotesPaymentId(notes: unknown): string | null {
  if (!notes || typeof notes !== 'object' || Array.isArray(notes)) {
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(notes, 'paymentId')) {
    return null;
  }
  return readBoundedString((notes as { paymentId?: unknown }).paymentId, NOTE_VALUE_MAX_LENGTH);
}

function readListedOrder(item: unknown): ListedProviderOrder | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return null;
  }
  const record = item as {
    id?: unknown;
    receipt?: unknown;
    amount?: unknown;
    currency?: unknown;
    notes?: unknown;
  };
  const providerOrderId = readBoundedString(record.id, ORDER_ID_MAX_LENGTH);
  if (!providerOrderId) {
    return null;
  }
  return {
    providerOrderId,
    receipt: readBoundedString(record.receipt, RECEIPT_MAX_LENGTH),
    amountInCents: readAmount(record.amount),
    currency: readBoundedString(record.currency, CURRENCY_MAX_LENGTH),
    notesPaymentId: readNotesPaymentId(record.notes)
  };
}

function isListingUnixSeconds(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value < MAX_LISTING_UNIX_SECONDS;
}

export function interpretOrderWindowPage(payload: unknown): OrderWindowLookup {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { kind: 'malformed' };
  }
  const items = (payload as { items?: unknown }).items;
  if (!Array.isArray(items)) {
    return { kind: 'malformed' };
  }
  const count = (payload as { count?: unknown }).count;
  if (typeof count !== 'number' || !Number.isInteger(count) || count !== items.length) {
    return { kind: 'malformed' };
  }
  if (items.length > ORDER_WINDOW_LOOKUP_PAGE_SIZE) {
    return { kind: 'malformed' };
  }

  const orders: ListedProviderOrder[] = [];
  for (const item of items) {
    const order = readListedOrder(item);
    if (!order) {
      return { kind: 'malformed' };
    }
    orders.push(order);
  }
  if (items.length === ORDER_WINDOW_LOOKUP_PAGE_SIZE) {
    return { kind: 'incomplete' };
  }
  return { kind: 'complete', orders };
}

export async function listOrdersInWindowWithClient(
  client: RazorpayOrderClient,
  input: ListOrdersInWindowInput,
  timeoutMs = ORDER_REQUEST_TIMEOUT_MS
): Promise<OrderWindowLookup> {
  if (!isListingUnixSeconds(input.from) || !isListingUnixSeconds(input.to) || input.from >= input.to) {
    throw new PaymentProviderRejectedError();
  }

  try {
    const payload = await withTimeout(
      client.orders.all({
        from: input.from,
        to: input.to,
        count: ORDER_WINDOW_LOOKUP_PAGE_SIZE,
        skip: 0
      }),
      timeoutMs
    );
    return interpretOrderWindowPage(payload);
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

  isVerificationConfigured(): boolean {
    return Boolean(env.RAZORPAY_KEY_SECRET);
  },

  publicKeyId(): string {
    if (!env.RAZORPAY_KEY_ID) {
      throw providerNotConfigured();
    }
    return env.RAZORPAY_KEY_ID;
  },

  createOrder(input: CreatePaymentOrderInput): Promise<CreatedPaymentOrder> {
    return createOrderWithClient(razorpayClient(), input);
  },

  listOrdersInWindow(input: ListOrdersInWindowInput): Promise<OrderWindowLookup> {
    return listOrdersInWindowWithClient(razorpayClient(), input);
  },

  verifyOrderSignature(input: VerifyOrderSignatureInput): boolean {
    const secret = env.RAZORPAY_KEY_SECRET;
    if (!secret) {
      throw verificationNotConfigured();
    }
    return verifyOrderPaymentSignature(
      input.storedOrderId,
      input.razorpayPaymentId,
      input.razorpaySignature,
      secret
    );
  }
};
