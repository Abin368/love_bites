import winston from 'winston';
import { env } from '../config/env';

const SENSITIVE_KEYS = new Set([
  'password',
  'password_hash',
  'passwordhash',
  'token',
  'refreshtoken',
  'refresh_token',
  'accesstoken',
  'access_token',
  'newpassword',
  'new_password',
  'secret',
  'otp',
  'authorization',
  'cookie',
  'set-cookie',
  'latitude',
  'longitude',
  'location',
  'coordinates'
]);

const SENSITIVE_COMPACT_KEYS = new Set([
  'password',
  'passwordhash',
  'token',
  'refreshtoken',
  'accesstoken',
  'newpassword',
  'secret',
  'otp',
  'authorization',
  'cookie',
  'setcookie',
  'latitude',
  'longitude',
  'location',
  'coordinates'
]);

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  const compact = lower.replace(/[_-]/g, '');
  return SENSITIVE_KEYS.has(lower) || SENSITIVE_COMPACT_KEYS.has(compact);
}

export function redactSensitiveData(obj: any): any {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(redactSensitiveData);
  }

  const redacted: Record<string, any> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveKey(key)) {
      redacted[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      redacted[key] = redactSensitiveData(value);
    } else {
      redacted[key] = value;
    }
  }

  return redacted;
}

const redactFormat = winston.format((info) => {
  return redactSensitiveData(info);
});

export const logger = winston.createLogger({
  level: env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    redactFormat(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      silent: env.NODE_ENV === 'test'
    })
  ]
});
