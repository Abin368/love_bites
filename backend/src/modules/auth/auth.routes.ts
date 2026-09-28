import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { rateLimitByIp } from '../../middleware/rate-limit.middleware';
import { validate } from '../../middleware/validate.middleware';
import * as authController from './auth.controller';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  verifyPhoneSchema
} from './auth.validator';

const router = Router();

router.post('/register', rateLimitByIp('ratelimit:auth:register', 5), validate(registerSchema), authController.register);
router.post('/verify-email', validate(verifyEmailSchema), authController.verifyEmail);
router.post('/verify-phone', validate(verifyPhoneSchema), authController.verifyPhone);
router.post('/resend-verification', validate(resendVerificationSchema), authController.resendVerification);
router.post('/login', rateLimitByIp('ratelimit:auth:login', 5), validate(loginSchema), authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', authenticate, authController.logout);
router.post('/forgot-password', rateLimitByIp('ratelimit:auth:forgot', 5), validate(forgotPasswordSchema), authController.forgotPassword);
router.post('/reset-password', validate(resetPasswordSchema), authController.resetPassword);

export const authRoutes = router;
