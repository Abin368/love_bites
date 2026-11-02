import {
  PaymentProviderOutcomeUnknownError,
  PaymentProviderRejectedError
} from '../../src/integrations/payment/payment.interface';
import {
  interpretOrderReceiptPage,
  listOrdersByReceiptWithClient,
  ORDER_RECEIPT_LOOKUP_PAGE_SIZE
} from '../../src/integrations/payment/razorpay.provider';

const receipt = '6e6e0001-0000-4000-8000-0000000000aa';

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

describe('Razorpay order receipt lookup', () => {
  it('requests the receipt on the first page and does not create an order', async () => {
    const all = jest.fn().mockResolvedValue(page([order()]));
    const create = jest.fn();

    const listed = await listOrdersByReceiptWithClient(client(all, create), receipt);

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
    expect(all).toHaveBeenCalledWith({
      receipt,
      count: ORDER_RECEIPT_LOOKUP_PAGE_SIZE,
      skip: 0
    });
    expect(create).not.toHaveBeenCalled();
    expect(ORDER_RECEIPT_LOOKUP_PAGE_SIZE).toBeGreaterThan(1);
  });

  it('treats an empty short page as a complete result with no orders', () => {
    expect(interpretOrderReceiptPage(page([]))).toEqual({ kind: 'complete', orders: [] });
  });

  it('treats a full page as incomplete even when the first order matches', () => {
    const full = page([order(), order({ id: 'order_lookup_2', receipt: 'other-receipt' })]);

    expect(full.items).toHaveLength(ORDER_RECEIPT_LOOKUP_PAGE_SIZE);
    expect(interpretOrderReceiptPage(full)).toEqual({ kind: 'incomplete' });
  });

  it('treats a count that does not match the returned items as malformed', () => {
    expect(interpretOrderReceiptPage(page([order()], 2))).toEqual({ kind: 'malformed' });
    expect(interpretOrderReceiptPage(page([], 1))).toEqual({ kind: 'malformed' });
    expect(interpretOrderReceiptPage({ items: [order()] })).toEqual({ kind: 'malformed' });
    expect(interpretOrderReceiptPage(null)).toEqual({ kind: 'malformed' });
    expect(interpretOrderReceiptPage({ count: 1, items: [null] })).toEqual({ kind: 'malformed' });
    expect(interpretOrderReceiptPage({ count: 1, items: [{ receipt, amount: 49900 }] })).toEqual({ kind: 'malformed' });
  });

  it('keeps a missing or non-integer amount, currency, receipt, and note available for rejection', () => {
    expect(interpretOrderReceiptPage(page([order({ amount: '49900' })]))).toMatchObject({
      kind: 'complete',
      orders: [{ amountInCents: null }]
    });
    expect(interpretOrderReceiptPage(page([order({ amount: 49900.5 })]))).toMatchObject({
      orders: [{ amountInCents: null }]
    });
    expect(interpretOrderReceiptPage(page([order({ currency: '' })]))).toMatchObject({
      orders: [{ currency: null }]
    });
    expect(interpretOrderReceiptPage(page([order({ receipt: undefined })]))).toMatchObject({
      orders: [{ receipt: null }]
    });
    expect(interpretOrderReceiptPage(page([order({ notes: [] })]))).toMatchObject({
      orders: [{ notesPaymentId: null }]
    });
    expect(interpretOrderReceiptPage(page([order({ notes: { paymentId: 12 } })]))).toMatchObject({
      orders: [{ notesPaymentId: null }]
    });
  });

  it('leaves a timeout, HTTP 429, and HTTP 500 as unknown outcomes without creating an order', async () => {
    const hanging = jest.fn().mockImplementation(() => new Promise(() => undefined));
    const create = jest.fn();
    await expect(listOrdersByReceiptWithClient(client(hanging, create), receipt, 20)).rejects.toBeInstanceOf(
      PaymentProviderOutcomeUnknownError
    );

    const limited = jest.fn().mockRejectedValue({ statusCode: 429 });
    await expect(listOrdersByReceiptWithClient(client(limited, create), receipt)).rejects.toBeInstanceOf(
      PaymentProviderOutcomeUnknownError
    );

    const serverError = jest.fn().mockRejectedValue({ statusCode: 500 });
    await expect(listOrdersByReceiptWithClient(client(serverError, create), receipt)).rejects.toBeInstanceOf(
      PaymentProviderOutcomeUnknownError
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects an invalid receipt before calling the provider', async () => {
    const all = jest.fn();

    await expect(listOrdersByReceiptWithClient(client(all), '')).rejects.toBeInstanceOf(PaymentProviderRejectedError);
    await expect(listOrdersByReceiptWithClient(client(all), 'x'.repeat(41))).rejects.toBeInstanceOf(
      PaymentProviderRejectedError
    );
    expect(all).not.toHaveBeenCalled();
  });
});
