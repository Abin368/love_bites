import { Response } from 'express';
import { asyncHandler } from '../../utils/async-handler';
import * as likesService from './likes.service';
import type { ListMatchesQuery } from './likes.validator';
import type { MatchListItem } from './likes.types';

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

function matchListItem(item: MatchListItem) {
  return {
    matchId: item.matchId,
    matchedAt: item.matchedAt,
    conversationId: item.conversationId,
    user: {
      id: item.user.id,
      firstName: item.user.firstName,
      age: item.user.age,
      city: item.user.city,
      primaryPhotoUrl: item.user.primaryPhotoUrl
    },
    lastMessage: item.lastMessage
      ? {
          id: item.lastMessage.id,
          senderId: item.lastMessage.senderId,
          messageType: item.lastMessage.messageType,
          content: item.lastMessage.content,
          createdAt: item.lastMessage.createdAt,
          mediaUrl: null
        }
      : null,
    unreadCount: item.unreadCount
  };
}

export const listMatches = asyncHandler(async (req, res) => {
  const query = res.locals.listMatchesQuery as ListMatchesQuery;
  const result = await likesService.listMatches({
    callerId: req.user!.id,
    isVerified: req.user!.isVerified,
    limit: query.limit,
    cursor: query.cursor
  });
  send(
    res,
    {
      items: result.items.map(matchListItem),
      pagination: {
        limit: result.limit,
        nextCursor: result.nextCursor,
        hasMore: result.hasMore
      }
    },
    'Matches retrieved.'
  );
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

export const getWhoLikedMe = asyncHandler(async (req, res) => {
  const result = await likesService.getWhoLikedMe({
    callerId: req.user!.id,
    isVerified: req.user!.isVerified
  });
  send(res, result.data, result.message);
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
