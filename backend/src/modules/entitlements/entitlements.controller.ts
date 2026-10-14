import { Response } from 'express';
import { asyncHandler } from '../../utils/async-handler';
import * as entitlementsService from './entitlements.service';

function send(res: Response, data: unknown, message: string): void {
  res.status(200).json({ success: true, data, message });
}

export const getEntitlements = asyncHandler(async (req, res) => {
  const snapshot = await entitlementsService.getCurrentEntitlements(req.user!.id);
  send(res, snapshot, 'Entitlements retrieved.');
});
