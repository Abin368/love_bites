import { z } from 'zod';

export const conversationIdSchema = z.string().uuid('Conversation id must be a valid UUID.');

export const sendTextMessageSchema = z
  .object({
    messageType: z.enum(['TEXT']),
    content: z.string()
  })
  .strict();

export type SendTextMessageBody = z.infer<typeof sendTextMessageSchema>;
