import { Response } from 'express';
import { asyncHandler } from '../../utils/async-handler';
import * as likesService from './likes.service';

function send(res: Response, data: unknown, message: string): void {
  res.status(200).json({ success: true, data, message });
}

export const passProfile = asyncHandler(async (req, res) => {
  const data = await likesService.passProfile({
    callerId: req.user!.id,
    isVerified: req.user!.isVerified,
    targetUserId: req.params.userId
  });
  send(res, data, 'Profile passed.');
});
