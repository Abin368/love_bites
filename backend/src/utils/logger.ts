import winston from 'winston';
import { env } from '../config/env';

const SENSITIVE_KEYS = new Set([
  'password',
  'password_hash',
  'token',
  'refreshtoken',
  'refresh_token',
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

function redactSensitiveData(obj: any): any {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(redactSensitiveData);
  }

  const redacted: Record<string, any> = {};

  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lowerKey)) {
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
