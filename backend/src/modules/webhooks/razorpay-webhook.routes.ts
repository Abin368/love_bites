import { Router } from 'express';
import * as razorpayWebhookController from './razorpay-webhook.controller';

const router = Router();

router.post('/razorpay', razorpayWebhookController.receiveRazorpayWebhook);

export const razorpayWebhookRoutes = router;
