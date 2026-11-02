import { createHmac } from 'crypto';
import { verifyOrderPaymentSignature } from '../../src/integrations/payment/razorpay.provider';

const SECRET = 'test-razorpay-key-secret';

function sign(storedOrderId: string, paymentId: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(`${storedOrderId}|${paymentId}`, 'utf8').digest('hex');
}

function expectRejected(
  signature: string,
  secret = SECRET,
  storedOrderId = 'order_stored',
  paymentId = 'pay_test_1'
): void {
  const verify = () => verifyOrderPaymentSignature(storedOrderId, paymentId, signature, secret);
  expect(verify).not.toThrow();
  expect(verify()).toBe(false);
}

describe('Razorpay order signature verification', () => {
  const signature = sign('order_stored', 'pay_test_1');

  it('accepts an HMAC of the stored order id and payment id', () => {
    expect(verifyOrderPaymentSignature('order_stored', 'pay_test_1', signature, SECRET)).toBe(true);
  });

  it('accepts the same HMAC in uppercase hexadecimal', () => {
    expect(verifyOrderPaymentSignature('order_stored', 'pay_test_1', signature.toUpperCase(), SECRET)).toBe(true);
  });

  it('rejects a signature built from a different order id', () => {
    expectRejected(sign('order_other', 'pay_test_1'));
  });

  it('rejects altered, truncated, odd-length, and extended signatures without throwing', () => {
    const altered = `${signature.slice(0, -1)}${signature.endsWith('a') ? 'b' : 'a'}`;

    expectRejected(altered);
    expectRejected(signature.slice(0, 32));
    expectRejected(signature.slice(0, 62));
    expectRejected(signature.slice(0, 63));
    expectRejected(`${signature}a`);
    expectRejected(`${signature}zz`);
    expectRejected(`${signature}!`);
    expectRejected(`${signature}00`);
    expectRejected(`${signature} `);
    expectRejected(`${signature.slice(0, 32)} ${signature.slice(32)}`);
    expectRejected(`${signature.slice(0, 10)}zz${signature.slice(12)}`);
    expectRejected('');
    expectRejected('z'.repeat(64));
  });

  it('rejects an empty secret, an empty order id, an empty payment id, and a wrong secret', () => {
    expectRejected(signature, '');
    expectRejected(signature, SECRET, '');
    expectRejected(signature, SECRET, 'order_stored', '');
    expectRejected(signature, 'wrong-razorpay-key-secret');
  });
});
