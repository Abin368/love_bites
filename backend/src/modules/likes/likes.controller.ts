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

export const likeProfile = asyncHandler(async (req, res) => {
  const body = await likesService.likeProfile({
    callerId: req.user!.id,
    isVerified: req.user!.isVerified,
    targetUserId: req.params.userId,
    idempotencyKey: req.get('Idempotency-Key')
  });
  res.status(200).json(body);
});

export const unmatch = asyncHandler(async (req, res) => {
  const data = await likesService.unmatch({
    callerId: req.user!.id,
    isVerified: req.user!.isVerified,
    matchId: req.params.matchId
  });
  send(res, data, 'Unmatched successfully.');
});

export const undoLastAction = asyncHandler(async (req, res) => {
  const data = await likesService.undoLastAction({
    callerId: req.user!.id,
    isVerified: req.user!.isVerified
  });
  send(res, data, 'Previous action undone.');
});

export const superLikeProfile = asyncHandler(async (req, res) => {
  const body = await likesService.superLikeProfile({
    callerId: req.user!.id,
    isVerified: req.user!.isVerified,
    targetUserId: req.params.userId,
    idempotencyKey: req.get('Idempotency-Key')
  });
  res.status(200).json(body);
});
