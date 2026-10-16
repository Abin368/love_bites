import { Response } from 'express';
import { asyncHandler } from '../../utils/async-handler';
import * as subscriptionsService from './subscriptions.service';

function send(res: Response, data: unknown, message: string): void {
  res.status(200).json({ success: true, data, message });
}

export const listPlans = asyncHandler(async (_req, res) => {
  const plans = await subscriptionsService.listActivePlans();
  send(res, plans, 'Plans retrieved successfully.');
});

export const getCurrentSubscription = asyncHandler(async (req, res) => {
  const state = await subscriptionsService.getCurrentSubscription(req.user!.id);
  send(res, state, 'Subscription retrieved successfully.');
});

export const cancelSubscription = asyncHandler(async (req, res) => {
  const result = await subscriptionsService.cancelSubscription(req.user!.id);
  send(res, result, 'Subscription cancelled. Premium access remains active until period end.');
});
