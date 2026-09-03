import { z } from 'zod';

/**
 * Environment is validated once at boot. A misconfigured deployment fails
 * loudly on startup rather than at 2am during the nightly backup.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  TZ: z.string().default('Asia/Kolkata'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be >= 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be >= 32 chars'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be 64 hex chars (32 bytes)'),
  MFA_ISSUER: z.string().default('Inventory Suite'),
  // Empty by default. Naming a role here forces every holder to enrol a
  // second factor, which locks out an account that has not enrolled yet -
  // so it is opt-in rather than a default that bites on first sign-in.
  MFA_REQUIRED_ROLES: z.string().default(''),
  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).default(12),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().min(1).default(15),

  API_PORT: z.coerce.number().int().default(4000),
  API_PREFIX: z.string().default('api/v1'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  RATE_LIMIT_TTL: z.coerce.number().int().default(60),
  RATE_LIMIT_MAX: z.coerce.number().int().default(300),
  TRUST_PROXY: z.coerce.boolean().default(false),

  // OAuth client id for "Continue with Google". Sign-in with Google is
  // simply unavailable until this is set; nothing else depends on it.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  GOOGLE_SHEETS_READONLY: z.coerce.boolean().default(true),
  SHEET_WINGWISE_ID: z.string().optional(),
  SHEET_CONTACT_CENTER_ID: z.string().optional(),
  SYNC_SCHEDULE: z.enum(['OFF', 'HOURLY', 'SIX_HOURLY', 'DAILY']).default('OFF'),
  SYNC_DAILY_AT_CRON: z.string().default('0 2 * * *'),
  SYNC_MAX_ROWS_PER_RUN: z.coerce.number().int().default(20000),

  BACKUP_DIR: z.string().default('./backups'),
  BACKUP_DAILY_CRON: z.string().default('0 1 * * *'),
  BACKUP_WEEKLY_CRON: z.string().default('0 3 * * 0'),
  BACKUP_DAILY_RETENTION: z.coerce.number().int().default(90),
  BACKUP_WEEKLY_RETENTION: z.coerce.number().int().default(52),
  PG_DUMP_PATH: z.string().default('pg_dump'),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./uploads'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().default('Inventory Suite <no-reply@example.com>'),
});

export type AppEnv = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): AppEnv {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration:\n${detail}\n\n` +
        'Copy .env.example to .env and fill in the missing values.',
    );
  }
  return parsed.data;
}

export const configuration = () => {
  const env = validateEnv(process.env);
  return {
    env,
    isProd: env.NODE_ENV === 'production',
    corsOrigins: env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    mfaRequiredRoles: env.MFA_REQUIRED_ROLES.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
};

export type AppConfig = ReturnType<typeof configuration>;
