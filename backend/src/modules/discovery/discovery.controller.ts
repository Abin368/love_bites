import { Response } from 'express';
import { asyncHandler } from '../../utils/async-handler';
import * as discoveryService from './discovery.service';

function send(res: Response, data: unknown, message: string): void {
  res.status(200).json({ success: true, data, message });
}

export const getNextCandidate = asyncHandler(async (req, res) => {
  const card = await discoveryService.getNextCandidate({
    id: req.user!.id,
    isVerified: req.user!.isVerified
  });
  send(res, card, 'Discovery candidate retrieved successfully');
});
