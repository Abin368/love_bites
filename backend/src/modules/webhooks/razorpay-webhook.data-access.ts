import { Transaction } from 'sequelize';
import '../../database/associations';
import { ProcessedWebhook } from '../../database/models/processed-webhook.model';

export async function findProcessedWebhook(
  eventId: string,
  transaction: Transaction
): Promise<ProcessedWebhook | null> {
  return ProcessedWebhook.findByPk(eventId, { transaction });
}

export async function insertProcessedWebhook(
  input: {
    eventId: string;
    eventType: string;
    payload: Record<string, unknown>;
    processedAt: Date;
  },
  transaction: Transaction
): Promise<void> {
  await ProcessedWebhook.create(
    {
      eventId: input.eventId,
      provider: 'RAZORPAY',
      eventType: input.eventType,
      payload: input.payload,
      processedAt: input.processedAt
    },
    { transaction }
  );
}
