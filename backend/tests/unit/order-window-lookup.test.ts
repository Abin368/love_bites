import {
  PaymentProviderOutcomeUnknownError,
  PaymentProviderRejectedError
} from '../../src/integrations/payment/payment.interface';
import {
  interpretOrderWindowPage,
  listOrdersInWindowWithClient,
  ORDER_WINDOW_LOOKUP_PAGE_SIZE
} from '../../src/integrations/payment/razorpay.provider';

const receipt = '6e6e0001-0000-4000-8000-0000000000aa';
const from = 1_762_000_000;
const to = 1_762_010_000;

function order(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'order_lookup_1',
    receipt,
    amount: 49900,
    currency: 'INR',
    notes: { paymentId: receipt },
    ...overrides
  };
}

function page(items: unknown[], count: number = items.length): { entity: string; count: number; items: unknown[] } {
  return { entity: 'collection', count, items };
}

function client(all: jest.Mock, create: jest.Mock = jest.fn()) {
  return { orders: { all, create } };
}

describe('Razorpay unfiltered order window lookup', () => {
  it('requests one unfiltered page of 100 and does not create an order', async () => {
    const all = jest.fn().mockResolvedValue(page([order()]));
    const create = jest.fn();

    const listed = await listOrdersInWindowWithClient(client(all, create), { from, to });

    expect(listed).toEqual({
      kind: 'complete',
      orders: [
        {
          providerOrderId: 'order_lookup_1',
          receipt,
          amountInCents: 49900,
          currency: 'INR',
          notesPaymentId: receipt
        }
      ]
    });
    expect(all).toHaveBeenCalledTimes(1);
    expect(all).toHaveBeenCalledWith({
      from,
      to,
      count: ORDER_WINDOW_LOOKUP_PAGE_SIZE,
      skip: 0
    });
    expect(all.mock.calls[0][0]).not.toHaveProperty('receipt');
    expect(create).not.toHaveBeenCalled();
    expect(ORDER_WINDOW_LOOKUP_PAGE_SIZE).toBe(100);
  });

  it('treats an empty short page as a complete result with no orders', () => {
    expect(interpretOrderWindowPage(page([]))).toEqual({ kind: 'complete', orders: [] });
  });

  it('treats a page of exactly 100 items as incomplete and does not request another page', async () => {
    const items = Array.from({ length: ORDER_WINDOW_LOOKUP_PAGE_SIZE }, (_, index) =>
      order({ id: `order_lookup_${index}` })
    );
    const all = jest.fn().mockResolvedValue(page(items));
    const create = jest.fn();

    const listed = await listOrdersInWindowWithClient(client(all, create), { from, to });

    expect(listed).toEqual({ kind: 'incomplete' });
    expect(all).toHaveBeenCalledTimes(1);
    expect(all.mock.calls[0][0].skip).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it('treats a malformed envelope or a count mismatch as malformed', () => {
    expect(interpretOrderWindowPage(page([order()], 2))).toEqual({ kind: 'malformed' });
    expect(interpretOrderWindowPage(page([], 1))).toEqual({ kind: 'malformed' });
    expect(interpretOrderWindowPage({ items: [order()] })).toEqual({ kind: 'malformed' });
    expect(interpretOrderWindowPage(null)).toEqual({ kind: 'malformed' });
    expect(interpretOrderWindowPage({ count: 1, items: [null] })).toEqual({ kind: 'malformed' });
    expect(interpretOrderWindowPage({ count: 1, items: [{ receipt, amount: 49900 }] })).toEqual({
      kind: 'malformed'
    });
    expect(interpretOrderWindowPage({ count: 2, items: [order(), null] })).toEqual({ kind: 'malformed' });
    expect(interpretOrderWindowPage(page([order({ id: 'x'.repeat(256) })]))).toEqual({ kind: 'malformed' });
  });

  it('keeps a missing or non-integer amount, currency, receipt, and note available for rejection', () => {
    expect(interpretOrderWindowPage(page([order({ amount: '49900' })]))).toMatchObject({
      kind: 'complete',
      orders: [{ amountInCents: null }]
    });
    expect(interpretOrderWindowPage(page([order({ amount: 49900.5 })]))).toMatchObject({
      orders: [{ amountInCents: null }]
    });
    expect(interpretOrderWindowPage(page([order({ currency: '' })]))).toMatchObject({
      orders: [{ currency: null }]
    });
    expect(interpretOrderWindowPage(page([order({ receipt: undefined })]))).toMatchObject({
      orders: [{ receipt: null }]
    });
    expect(interpretOrderWindowPage(page([order({ notes: [] })]))).toMatchObject({
      orders: [{ notesPaymentId: null }]
    });
    expect(interpretOrderWindowPage(page([order({ notes: { paymentId: 12 } })]))).toMatchObject({
      orders: [{ notesPaymentId: null }]
    });
  });

  it('leaves a timeout, HTTP 408, HTTP 429, and HTTP 500 as unknown outcomes', async () => {
    const hanging = jest.fn().mockImplementation(() => new Promise(() => undefined));
    const create = jest.fn();
    await expect(listOrdersInWindowWithClient(client(hanging, create), { from, to }, 20)).rejects.toBeInstanceOf(
      PaymentProviderOutcomeUnknownError
    );

    const timedOut = jest.fn().mockRejectedValue({ statusCode: 408 });
    await expect(listOrdersInWindowWithClient(client(timedOut, create), { from, to })).rejects.toBeInstanceOf(
      PaymentProviderOutcomeUnknownError
    );

    const limited = jest.fn().mockRejectedValue({ statusCode: 429 });
    await expect(listOrdersInWindowWithClient(client(limited, create), { from, to })).rejects.toBeInstanceOf(
      PaymentProviderOutcomeUnknownError
    );

    const serverError = jest.fn().mockRejectedValue({ statusCode: 500 });
    await expect(listOrdersInWindowWithClient(client(serverError, create), { from, to })).rejects.toBeInstanceOf(
      PaymentProviderOutcomeUnknownError
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('classifies other HTTP 4xx as a provider rejection', async () => {
    const rejected = jest.fn().mockRejectedValue({ statusCode: 400 });
    const create = jest.fn();

    await expect(listOrdersInWindowWithClient(client(rejected, create), { from, to })).rejects.toBeInstanceOf(
      PaymentProviderRejectedError
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a non-integer, millisecond, or inverted window before calling the provider', async () => {
    const all = jest.fn();

    await expect(listOrdersInWindowWithClient(client(all), { from: 1.5, to })).rejects.toBeInstanceOf(
      PaymentProviderRejectedError
    );
    await expect(
      listOrdersInWindowWithClient(client(all), { from: 1_762_000_000_000, to: 1_762_000_300_000 })
    ).rejects.toBeInstanceOf(PaymentProviderRejectedError);
    await expect(listOrdersInWindowWithClient(client(all), { from: to, to: from })).rejects.toBeInstanceOf(
      PaymentProviderRejectedError
    );
    expect(all).not.toHaveBeenCalled();
  });
});
