import { createHmac } from 'crypto';
import { verifyOrderPaymentSignature } from '../../src/integrations/payment/razorpay.provider';

const SECRET = 'test-razorpay-key-secret';

function sign(storedOrderId: string, paymentId: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(`${storedOrderId}|${paymentId}`, 'utf8').digest('hex');
}

describe('Razorpay order signature verification', () => {
  it('accepts an HMAC of the stored order id and payment id', () => {
    const signature = sign('order_stored', 'pay_test_1');

    expect(verifyOrderPaymentSignature('order_stored', 'pay_test_1', signature, SECRET)).toBe(true);
  });

  it('rejects a signature built from a different order id', () => {
    const signature = sign('order_other', 'pay_test_1');

    expect(verifyOrderPaymentSignature('order_stored', 'pay_test_1', signature, SECRET)).toBe(false);
  });

  it('rejects an altered, truncated, or non-hex signature without throwing', () => {
    const signature = sign('order_stored', 'pay_test_1');
    const altered = `${signature.slice(0, -1)}${signature.endsWith('a') ? 'b' : 'a'}`;

    expect(verifyOrderPaymentSignature('order_stored', 'pay_test_1', altered, SECRET)).toBe(false);
    expect(verifyOrderPaymentSignature('order_stored', 'pay_test_1', signature.slice(0, 32), SECRET)).toBe(false);
    expect(verifyOrderPaymentSignature('order_stored', 'pay_test_1', 'z'.repeat(64), SECRET)).toBe(false);
    expect(verifyOrderPaymentSignature('order_stored', 'pay_test_1', '', SECRET)).toBe(false);
  });

  it('rejects an empty secret', () => {
    const signature = sign('order_stored', 'pay_test_1');

    expect(verifyOrderPaymentSignature('order_stored', 'pay_test_1', signature, '')).toBe(false);
  });
});
