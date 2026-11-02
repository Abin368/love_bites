import { createHmac } from 'crypto';
import { verifyWebhookSignature } from '../../src/integrations/payment/razorpay.provider';

const SECRET = 'test-razorpay-webhook-secret';

function sign(raw: Buffer | string, secret = SECRET): string {
  return createHmac('sha256', secret).update(raw).digest('hex');
}

function expectRejected(raw: Buffer, signature: string, secret = SECRET): void {
  const verify = () => verifyWebhookSignature(raw, signature, secret);
  expect(verify).not.toThrow();
  expect(verify()).toBe(false);
}

describe('Razorpay webhook signature verification', () => {
  const raw = Buffer.from('{"id":"evt_1","event":"payment.captured"}', 'utf8');
  const signature = sign(raw);

  it('accepts an HMAC of the exact raw bytes', () => {
    expect(verifyWebhookSignature(raw, signature, SECRET)).toBe(true);
  });

  it('accepts the same HMAC in uppercase hexadecimal', () => {
    expect(verifyWebhookSignature(raw, signature.toUpperCase(), SECRET)).toBe(true);
  });

  it('rejects a signature for different bytes, including key order and whitespace', () => {
    const reordered = Buffer.from('{"event":"payment.captured","id":"evt_1"}', 'utf8');
    const spaced = Buffer.from('{"id":"evt_1", "event":"payment.captured"}', 'utf8');

    expectRejected(reordered, signature);
    expectRejected(spaced, signature);
    expect(verifyWebhookSignature(reordered, sign(reordered), SECRET)).toBe(true);
  });

  it('rejects an empty signature, a wrong secret, and an empty body without throwing', () => {
    expectRejected(raw, '');
    expectRejected(raw, signature, 'other-secret');
    expectRejected(Buffer.alloc(0), sign(Buffer.alloc(0)));
    expectRejected(raw, signature, '');
  });

  it('rejects truncated, odd-length, non-hex, and extended signatures', () => {
    expectRejected(raw, signature.slice(0, 32));
    expectRejected(raw, signature.slice(0, 63));
    expectRejected(raw, `${signature.slice(0, 10)}zz${signature.slice(12)}`);
    expectRejected(raw, `${signature}00`);
    expectRejected(raw, `${signature} `);
  });

  it('rejects the checkout order and payment MAC', () => {
    const checkoutMac = createHmac('sha256', SECRET).update('order_1|pay_1', 'utf8').digest('hex');
    expectRejected(raw, checkoutMac);
  });
});
