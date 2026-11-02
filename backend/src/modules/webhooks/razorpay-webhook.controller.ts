import { env } from '../../config/env';
import { verifyWebhookSignature } from '../../integrations/payment/razorpay.provider';
import { asyncHandler } from '../../utils/async-handler';
import { InternalServerError, ValidationError } from '../../utils/errors';
import { processRazorpayWebhook } from './razorpay-webhook.service';

function webhookNotConfigured(): InternalServerError {
  return new InternalServerError(
    'Payment webhook is not configured.',
    [],
    'WEBHOOK_NOT_CONFIGURED',
    true
  );
}

function invalidSignature(): ValidationError {
  return new ValidationError('Webhook signature is invalid.');
}

function invalidJson(): ValidationError {
  return new ValidationError('Invalid JSON payload structure.');
}

function invalidEventId(): ValidationError {
  return new ValidationError('Webhook event id is invalid.');
}

const EVENT_ID_MAX_LENGTH = 255;

function readWebhookEventId(value: string | undefined): string {
  if (value === undefined) {
    throw invalidEventId();
  }
  const eventId = value.trim();
  if (eventId.length === 0 || eventId.length > EVENT_ID_MAX_LENGTH) {
    throw invalidEventId();
  }
  return eventId;
}

export const receiveRazorpayWebhook = asyncHandler(async (req, res) => {
  const secret = env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    throw webhookNotConfigured();
  }

  const signature = req.get('X-Razorpay-Signature');
  const rawBody = req.rawBody;
  if (!signature || !rawBody || !verifyWebhookSignature(rawBody, signature, secret)) {
    throw invalidSignature();
  }

  let event: unknown;
  try {
    event = JSON.parse(rawBody.toString('utf8')) as unknown;
  } catch {
    throw invalidJson();
  }

  const eventId = readWebhookEventId(req.get('X-Razorpay-Event-Id'));
  await processRazorpayWebhook(event, eventId);

  res.status(200).json({
    success: true,
    data: null,
    message: 'Webhook received.'
  });
});
