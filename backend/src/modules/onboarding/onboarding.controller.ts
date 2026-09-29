import { Response } from 'express';
import { asyncHandler } from '../../utils/async-handler';
import * as onboardingService from './onboarding.service';
import type { ReplaceInterestsBody, ReplaceRelationshipIntentionsBody } from './onboarding.validator';

function send(res: Response, data: unknown, message: string): void {
  res.status(200).json({ success: true, data, message });
}

export const replaceInterests = asyncHandler(async (req, res) => {
  const body = req.body as ReplaceInterestsBody;
  const interests = await onboardingService.replaceOwnInterests(req.user!.id, body.interestIds);
  send(res, interests, 'Interests updated successfully');
});

export const replaceRelationshipIntentions = asyncHandler(async (req, res) => {
  const body = req.body as ReplaceRelationshipIntentionsBody;
  const intentions = await onboardingService.replaceOwnRelationshipIntentions(
    req.user!.id,
    body.relationshipIntentionIds
  );
  send(res, intentions, 'Relationship intentions updated successfully');
});
