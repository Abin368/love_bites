import { Response } from 'express';
import { asyncHandler } from '../../utils/async-handler';
import * as relationshipIntentionsService from './relationship-intentions.service';

function send(res: Response, data: unknown, message: string): void {
  res.status(200).json({ success: true, data, message });
}

export const listRelationshipIntentions = asyncHandler(async (_req, res) => {
  const intentions = await relationshipIntentionsService.listActiveRelationshipIntentions();
  send(res, intentions, 'Relationship intentions retrieved successfully');
});
