import {
  PaymentProviderOutcomeUnknownError,
  PaymentProviderRejectedError,
  type CreatePaymentOrderInput
} from '../../src/integrations/payment/payment.interface';
import { classifyRazorpayFailure, createOrderWithClient } from '../../src/integrations/payment/razorpay.provider';

const paymentId = '6e6e0001-0000-4000-8000-0000000000aa';

function input(overrides: Partial<CreatePaymentOrderInput> = {}): CreatePaymentOrderInput {
  return {
    amountInCents: 49900,
    currency: 'INR',
    receipt: paymentId,
    paymentId,
    ...overrides
  };
}

describe('Razorpay order creation', () => {
  it('classifies provider HTTP failures without treating transport loss as a rejection', () => {
    expect(classifyRazorpayFailure({ statusCode: 400, error: { description: 'amount is invalid' } })).toBe('rejected');
    expect(classifyRazorpayFailure({ statusCode: '401' })).toBe('rejected');
    expect(classifyRazorpayFailure({ statusCode: 408 })).toBe('unknown');
    expect(classifyRazorpayFailure({ statusCode: 429 })).toBe('unknown');
    expect(classifyRazorpayFailure({ statusCode: 500 })).toBe('unknown');
    expect(classifyRazorpayFailure(new Error('timeout'))).toBe('unknown');
  });

  it('creates an order with the snapshotted paise amount, INR, and the payment id as the receipt', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'order_test_1', status: 'created' });

    const created = await createOrderWithClient({ orders: { create } }, input());

    expect(created).toEqual({ providerOrderId: 'order_test_1' });
    expect(create).toHaveBeenCalledWith({
      amount: 49900,
      currency: 'INR',
      receipt: paymentId,
      notes: { paymentId }
    });
  });

  it('turns a confirmed provider rejection into a rejected error that omits the provider payload', async () => {
    const create = jest.fn().mockRejectedValue({
      statusCode: 400,
      error: { description: 'secret-looking provider body', code: 'BAD_REQUEST_ERROR' }
    });

    await expect(createOrderWithClient({ orders: { create } }, input())).rejects.toBeInstanceOf(
      PaymentProviderRejectedError
    );
    await expect(createOrderWithClient({ orders: { create } }, input())).rejects.not.toThrow(/secret-looking/);
  });

  it('treats a provider 500 and a lost response as an unknown outcome', async () => {
    const serverError = jest.fn().mockRejectedValue({ statusCode: 500, error: { description: 'internal' } });
    await expect(createOrderWithClient({ orders: { create: serverError } }, input())).rejects.toBeInstanceOf(
      PaymentProviderOutcomeUnknownError
    );

    const hanging = jest.fn().mockImplementation(() => new Promise(() => undefined));
    await expect(createOrderWithClient({ orders: { create: hanging } }, input(), 20)).rejects.toBeInstanceOf(
      PaymentProviderOutcomeUnknownError
    );
    expect(hanging).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid local order body before calling the provider', async () => {
    const create = jest.fn();

    await expect(createOrderWithClient({ orders: { create } }, input({ amountInCents: 0 }))).rejects.toBeInstanceOf(
      PaymentProviderRejectedError
    );
    await expect(
      createOrderWithClient({ orders: { create } }, input({ receipt: 'x'.repeat(41) }))
    ).rejects.toBeInstanceOf(PaymentProviderRejectedError);
    expect(create).not.toHaveBeenCalled();
  });
});
