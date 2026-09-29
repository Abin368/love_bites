import { Response } from 'express';
import { asyncHandler } from '../../utils/async-handler';
import * as interestsService from './interests.service';

function send(res: Response, data: unknown, message: string): void {
  res.status(200).json({ success: true, data, message });
}

export const listInterests = asyncHandler(async (_req, res) => {
  const interests = await interestsService.listActiveInterests();
  send(res, interests, 'Interests retrieved successfully');
});
