import { Response } from 'express';
import { asyncHandler } from '../../utils/async-handler';
import * as onboardingService from './onboarding.service';
import type {
  ReplaceDatingPreferencesBody,
  ReplaceInterestsBody,
  ReplaceRelationshipIntentionsBody,
  SaveLocationBody
} from './onboarding.validator';

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

export const replaceDatingPreferences = asyncHandler(async (req, res) => {
  const body = req.body as ReplaceDatingPreferencesBody;
  const preferences = await onboardingService.replaceOwnDatingPreferences(req.user!.id, body);
  send(res, preferences, 'Dating preferences updated successfully');
});

export const updateLocation = asyncHandler(async (req, res) => {
  const body = req.body as SaveLocationBody;
  const location = await onboardingService.updateOwnLocation(req.user!.id, body);
  send(res, location, 'Location updated successfully');
});

export const getStatus = asyncHandler(async (req, res) => {
  const status = await onboardingService.getOwnOnboardingStatus(
    req.user!.id,
    req.user!.isVerified,
    req.user!.isProfileComplete
  );
  send(res, status, 'Onboarding status retrieved successfully');
});

export const completeOnboarding = asyncHandler(async (req, res) => {
  const completion = await onboardingService.completeOwnOnboarding(
    req.user!.id,
    req.user!.isVerified,
    req.user!.isProfileComplete,
    req.user!.status
  );
  send(res, completion, 'Onboarding complete! Welcome to Love Bite.');
});
