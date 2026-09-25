import { CookieOptions, Request, Response } from 'express';
import { env } from '../../config/env';
import { asyncHandler } from '../../utils/async-handler';
import * as authService from './auth.service';
import type {
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResendVerificationInput,
  ResetPasswordInput,
  VerifyEmailInput,
  VerifyPhoneInput
} from './auth.validator';

const REFRESH_COOKIE_NAME = 'refreshToken';
const REFRESH_COOKIE_PATH = '/api/v1/auth/refresh';
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function cookieBase(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH
  };
}

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    ...cookieBase(),
    maxAge: REFRESH_COOKIE_MAX_AGE_MS
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, cookieBase());
}

function send(res: Response, status: number, data: unknown, message: string): void {
  res.status(status).json({ success: true, data, message });
}

function deviceInfo(req: Request): string | null {
  const userAgent = req.get('user-agent');
  return userAgent ? userAgent.slice(0, 255) : null;
}

function ipAddress(req: Request): string | null {
  const ip = req.ip || req.socket.remoteAddress;
  return ip ? ip.slice(0, 45) : null;
}

export const register = asyncHandler(async (req, res) => {
  const result = await authService.register(req.body as RegisterInput);
  send(res, 201, result, 'Registration successful. Please verify your account.');
});

export const verifyEmail = asyncHandler(async (req, res) => {
  const result = await authService.verifyEmail(req.body as VerifyEmailInput);
  send(res, 200, result, 'Email verified successfully.');
});

export const verifyPhone = asyncHandler(async (req, res) => {
  const result = await authService.verifyPhone(req.body as VerifyPhoneInput);
  send(res, 200, result, 'Phone number verified successfully.');
});

export const resendVerification = asyncHandler(async (req, res) => {
  const result = await authService.resendVerification(req.body as ResendVerificationInput);
  send(res, 200, result, 'Verification code resent.');
});

export const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body as LoginInput, deviceInfo(req), ipAddress(req));
  setRefreshCookie(res, result.refreshToken);
  send(
    res,
    200,
    {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      user: result.user
    },
    'Login successful.'
  );
});

export const refresh = asyncHandler(async (req, res) => {
  const result = await authService.refresh(req.cookies?.refreshToken, deviceInfo(req), ipAddress(req));
  setRefreshCookie(res, result.refreshToken);
  send(
    res,
    200,
    {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn
    },
    'Token refreshed.'
  );
});

export const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.user!.id, req.cookies?.refreshToken);
  clearRefreshCookie(res);
  send(res, 200, null, 'Logged out successfully.');
});

export const forgotPassword = asyncHandler(async (req, res) => {
  await authService.forgotPassword(req.body as ForgotPasswordInput);
  send(
    res,
    200,
    null,
    'If an account exists for this identifier, password reset instructions have been sent.'
  );
});

export const resetPassword = asyncHandler(async (req, res) => {
  await authService.resetPassword(req.body as ResetPasswordInput);
  send(res, 200, null, 'Password reset successfully. Please log in.');
});
