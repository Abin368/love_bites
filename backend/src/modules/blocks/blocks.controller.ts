import { Response } from 'express';
import { deliverMatchUnmatch } from '../../socket/chat.socket';
import { asyncHandler } from '../../utils/async-handler';
import * as blocksService from './blocks.service';

function send(res: Response, data: unknown, message: string): void {
  res.status(200).json({ success: true, data, message });
}

export const blockUser = asyncHandler(async (req, res) => {
  const result = await blocksService.blockUser({
    callerId: req.user!.id,
    targetUserId: req.params.userId
  });

  if (result.unmatchEvent) {
    deliverMatchUnmatch(result.unmatchEvent);
  }

  send(res, { blocked: true, targetUserId: result.targetUserId }, 'User blocked successfully.');
});

export const listBlocks = asyncHandler(async (req, res) => {
  const blocks = await blocksService.listBlocks(req.user!.id);
  send(res, blocks, 'Blocked users retrieved.');
});

export const unblockUser = asyncHandler(async (req, res) => {
  const result = await blocksService.unblockUser({
    callerId: req.user!.id,
    targetUserId: req.params.userId
  });
  send(res, result, 'User unblocked successfully.');
});
