import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Load .env file
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const optionalEnvString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).optional()
);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().positive().default(5000),
  API_PREFIX: z.string().default('/api/v1'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'debug']).default('info'),

  // PostgreSQL Database Configuration
  DATABASE_URL: z.string().optional(),
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().default(5432),
  DB_NAME: z.string().default('love_bites_dev'),
  DB_USER: z.string().default('postgres'),
  DB_PASSWORD: z.string().default('postgres'),
  DB_POOL_MAX: z.coerce.number().default(20),
  DB_POOL_MIN: z.coerce.number().default(5),
  DB_POOL_IDLE: z.coerce.number().default(10000),

  // Redis Configuration
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // JWT Configuration (Secrets validated in Phase 2, optional defaults provided for Phase 0)
  JWT_ACCESS_SECRET: z.string().min(16).default('development-jwt-access-secret-minimum-16-chars'),
  JWT_REFRESH_SECRET: z.string().min(16).default('development-jwt-refresh-secret-minimum-16-chars'),
  JWT_ACCESS_EXPIRATION: z.string().default('15m'),
  // Opaque refresh tokens do not use JWT_REFRESH_SECRET. It stays configured for compatibility.
  JWT_REFRESH_EXPIRATION: z.string().default('7d'),

  // Photo storage. Credentials come from the AWS SDK default provider chain.
  // Required in production. Development and test can boot without them.
  AWS_REGION: optionalEnvString,
  AWS_S3_BUCKET_NAME: optionalEnvString
}).superRefine((data, ctx) => {
  if (data.NODE_ENV !== 'production') {
    return;
  }

  if (!data.AWS_REGION) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['AWS_REGION'],
      message: 'AWS_REGION is required in production'
    });
  }

  if (!data.AWS_S3_BUCKET_NAME) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['AWS_S3_BUCKET_NAME'],
      message: 'AWS_S3_BUCKET_NAME is required in production'
    });
  }

  const secret = data.JWT_ACCESS_SECRET;
  const placeholder =
    secret.startsWith('development-jwt') ||
    secret.includes('change-me') ||
    secret.includes('your-super-secret');

  if (secret.length < 32 || placeholder) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['JWT_ACCESS_SECRET'],
      message:
        'JWT_ACCESS_SECRET must be at least 32 characters and must not use a development placeholder in production'
    });
  }
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const formattedErrors = parsed.error.format();
    console.error('❌ Environment validation failed on startup:');
    console.error(JSON.stringify(formattedErrors, null, 2));
    process.exit(1);
  }

  return parsed.data;
}

export const env = validateEnv();
