import { Response } from 'express';
import { asyncHandler } from '../../utils/async-handler';
import * as profilesService from './profiles.service';
import type { CreateProfileBody, UpdateProfileBody } from './profiles.validator';

function send(res: Response, status: number, data: unknown, message: string): void {
  res.status(status).json({ success: true, data, message });
}

export const getProfile = asyncHandler(async (req, res) => {
  const profile = await profilesService.getOwnProfile(req.user!.id);
  send(res, 200, profile, 'Profile retrieved successfully');
});

export const createProfile = asyncHandler(async (req, res) => {
  const profile = await profilesService.createOwnProfile(req.user!.id, req.body as CreateProfileBody);
  send(res, 201, profile, 'Profile created successfully');
});

export const updateProfile = asyncHandler(async (req, res) => {
  const profile = await profilesService.updateOwnProfile(req.user!.id, req.body as UpdateProfileBody);
  send(res, 200, profile, 'Profile updated successfully');
});
