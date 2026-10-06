import { z } from 'zod';

export const targetUserIdSchema = z.string().uuid('User id must be a valid UUID.');
