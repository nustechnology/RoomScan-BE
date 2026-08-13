import { isIP } from 'node:net';

import { z } from 'zod';

const MAX_MEMORY_STORE_WINDOW_SECONDS = Math.floor(2_147_483_647 / 1000);
const TRUSTED_PROXY_NAMES = new Set(['loopback', 'linklocal', 'uniquelocal']);

const postgresUrlSchema = z
  .url()
  .refine((value) => value.startsWith('postgresql://') || value.startsWith('postgres://'), {
    message: 'DATABASE_URL must use the postgresql:// or postgres:// protocol',
  });

export type TrustProxy = false | number | string[];

function isValidTrustedProxy(value: string): boolean {
  if (TRUSTED_PROXY_NAMES.has(value)) {
    return true;
  }

  const [address, prefix, ...remainder] = value.split('/');
  if (address === undefined || remainder.length > 0) {
    return false;
  }

  const addressFamily = isIP(address);
  if (addressFamily === 0) {
    return false;
  }

  if (prefix === undefined) {
    return true;
  }

  if (!/^\d+$/.test(prefix)) {
    return false;
  }

  const prefixLength = Number(prefix);
  const maximumPrefixLength = addressFamily === 4 ? 32 : 128;
  return prefixLength >= 0 && prefixLength <= maximumPrefixLength;
}

const trustProxySchema = z
  .string()
  .trim()
  .optional()
  .default('')
  .transform<TrustProxy>((value, context) => {
    if (value === '' || value === 'false') {
      return false;
    }

    if (value === 'true') {
      context.addIssue({
        code: 'custom',
        message: 'TRUST_PROXY cannot trust every proxy',
      });
      return z.NEVER;
    }

    if (/^\d+$/.test(value)) {
      const hops = Number(value);
      if (Number.isSafeInteger(hops) && hops > 0) {
        return hops;
      }

      context.addIssue({
        code: 'custom',
        message: 'TRUST_PROXY hop count must be a positive integer',
      });
      return z.NEVER;
    }

    const trustedProxies = value.split(',').map((entry) => entry.trim());
    if (trustedProxies.some((entry) => entry.length === 0 || !isValidTrustedProxy(entry))) {
      context.addIssue({
        code: 'custom',
        message: 'TRUST_PROXY must contain valid IP addresses, CIDRs, or named subnets',
      });
      return z.NEVER;
    }

    return trustedProxies;
  });

const rateLimitWindowSecondsSchema = z.coerce
  .number()
  .int()
  .positive()
  .max(MAX_MEMORY_STORE_WINDOW_SECONDS);
const rateLimitMaxRequestsSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const environmentBooleanSchema = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

export const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'staging', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    DATABASE_URL: postgresUrlSchema,
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    CORS_ORIGIN: z.string().trim().min(1).default('*'),
    TRUST_PROXY: trustProxySchema,
    RATE_LIMIT_API_WINDOW_SECONDS: rateLimitWindowSecondsSchema.default(60),
    RATE_LIMIT_API_MAX_REQUESTS: rateLimitMaxRequestsSchema.default(120),
    RATE_LIMIT_APPLE_AUTH_WINDOW_SECONDS: rateLimitWindowSecondsSchema.default(900),
    RATE_LIMIT_APPLE_AUTH_MAX_REQUESTS: rateLimitMaxRequestsSchema.default(20),
    RATE_LIMIT_REFRESH_AUTH_WINDOW_SECONDS: rateLimitWindowSecondsSchema.default(900),
    RATE_LIMIT_REFRESH_AUTH_MAX_REQUESTS: rateLimitMaxRequestsSchema.default(10),
    APPLE_CLIENT_ID: z.string().trim().min(1).max(255),
    AUTH_ACCESS_TOKEN_SECRET: z.string().min(32),
    AUTH_REFRESH_TOKEN_SECRET: z.string().min(32),
    AUTH_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
    AUTH_REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),
    LOCAL_TEST_AUTH_ENABLED: environmentBooleanSchema,
    STORAGE_PROVIDER: z.enum(['local', 'minio']).default('local'),
    STORAGE_BUCKET: z.string().trim().default(''),
    STORAGE_REGION: z.string().trim().default(''),
    STORAGE_ENDPOINT: z.string().trim().default(''),
    STORAGE_ACCESS_KEY_ID: z.string().trim().default(''),
    STORAGE_SECRET_ACCESS_KEY: z.string().trim().default(''),
    STORAGE_USE_SSL: environmentBooleanSchema,
    STORAGE_UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    STORAGE_DOWNLOAD_URL_TTL_SECONDS: z.coerce.number().int().positive().default(60),
    ASSET_MIN_MODEL_SIZE_BYTES: z.coerce.number().int().nonnegative().default(0),
    ASSET_MAX_MODEL_SIZE_BYTES: z.coerce.number().int().positive().default(200_000_000),
    ASSET_MAX_THUMBNAIL_SIZE_BYTES: z.coerce.number().int().positive().default(10_000_000),
    INVITATION_TTL_SECONDS: z.coerce.number().int().positive().default(604_800),
    IDEMPOTENCY_KEY_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
    INVITATION_BASE_URL: z
      .string()
      .trim()
      .min(1)
      .url()
      .default('http://localhost:3000')
      .transform((value) => value.replace(/\/+$/, '')),
    MAIL_PROVIDER: z.enum(['log', 'smtp']).default('log'),
    SMTP_HOST: z.string().trim().default(''),
    SMTP_PORT: z.coerce.number().int().positive().max(65_535).default(2525),
    SMTP_USER: z.string().trim().default(''),
    SMTP_PASS: z.string().trim().default(''),
    SMTP_SECURE: environmentBooleanSchema,
    MAIL_FROM: z.string().trim().min(1).default('RoomScan App <notifications@roomscan.app>'),
  })
  .superRefine((environment, context) => {
    if (environment.AUTH_REFRESH_TOKEN_TTL_SECONDS <= environment.AUTH_ACCESS_TOKEN_TTL_SECONDS) {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_REFRESH_TOKEN_TTL_SECONDS'],
        message: 'AUTH_REFRESH_TOKEN_TTL_SECONDS must be greater than access token TTL',
      });
    }

    if (environment.LOCAL_TEST_AUTH_ENABLED && environment.NODE_ENV !== 'development') {
      context.addIssue({
        code: 'custom',
        path: ['LOCAL_TEST_AUTH_ENABLED'],
        message: 'LOCAL_TEST_AUTH_ENABLED may only be enabled when NODE_ENV=development',
      });
    }

    if (environment.NODE_ENV === 'production' && environment.STORAGE_PROVIDER === 'local') {
      context.addIssue({
        code: 'custom',
        path: ['STORAGE_PROVIDER'],
        message: 'STORAGE_PROVIDER=local is not allowed when NODE_ENV=production',
      });
    }

    if (
      environment.MAIL_PROVIDER === 'log' &&
      environment.NODE_ENV !== 'development' &&
      environment.NODE_ENV !== 'test'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['MAIL_PROVIDER'],
        message: 'MAIL_PROVIDER=log is only allowed when NODE_ENV is development or test',
      });
    }

    if (environment.STORAGE_PROVIDER === 'minio') {
      const requiredStorage: Array<[keyof typeof environmentSchema.shape, string]> = [
        ['STORAGE_BUCKET', environment.STORAGE_BUCKET],
        ['STORAGE_ENDPOINT', environment.STORAGE_ENDPOINT],
        ['STORAGE_ACCESS_KEY_ID', environment.STORAGE_ACCESS_KEY_ID],
        ['STORAGE_SECRET_ACCESS_KEY', environment.STORAGE_SECRET_ACCESS_KEY],
      ];
      for (const [name, value] of requiredStorage) {
        if (value.trim().length === 0) {
          context.addIssue({
            code: 'custom',
            path: [name],
            message: `${name} is required when STORAGE_PROVIDER=minio`,
          });
        }
      }
    }

    if (environment.MAIL_PROVIDER === 'smtp') {
      const requiredSmtp: Array<[keyof typeof environmentSchema.shape, string]> = [
        ['SMTP_HOST', environment.SMTP_HOST],
        ['SMTP_USER', environment.SMTP_USER],
        ['SMTP_PASS', environment.SMTP_PASS],
      ];
      for (const [name, value] of requiredSmtp) {
        if (value.trim().length === 0) {
          context.addIssue({
            code: 'custom',
            path: [name],
            message: `${name} is required when MAIL_PROVIDER=smtp`,
          });
        }
      }
    }

    if (environment.ASSET_MIN_MODEL_SIZE_BYTES >= environment.ASSET_MAX_MODEL_SIZE_BYTES) {
      context.addIssue({
        code: 'custom',
        path: ['ASSET_MAX_MODEL_SIZE_BYTES'],
        message: 'ASSET_MAX_MODEL_SIZE_BYTES must be greater than ASSET_MIN_MODEL_SIZE_BYTES',
      });
    }
  });

export interface AppConfig {
  nodeEnv: z.infer<typeof environmentSchema>['NODE_ENV'];
  port: number;
  databaseUrl: string;
  logLevel: z.infer<typeof environmentSchema>['LOG_LEVEL'];
  corsOrigins: '*' | string[];
  trustProxy: TrustProxy;
  apiRateLimitWindowSeconds: number;
  apiRateLimitMaxRequests: number;
  appleAuthRateLimitWindowSeconds: number;
  appleAuthRateLimitMaxRequests: number;
  refreshAuthRateLimitWindowSeconds: number;
  refreshAuthRateLimitMaxRequests: number;
  appleClientId: string;
  accessTokenSecret: string;
  refreshTokenSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  localTestAuthEnabled: boolean;
  storageProvider: string;
  storageBucket: string;
  storageRegion: string;
  storageEndpoint: string;
  storageAccessKeyId: string;
  storageSecretAccessKey: string;
  storageUseSsl: boolean;
  storageUploadUrlTtlSeconds: number;
  storageDownloadUrlTtlSeconds: number;
  assetMinModelSizeBytes: number;
  assetMaxModelSizeBytes: number;
  assetMaxThumbnailSizeBytes: number;
  invitationTtlSeconds: number;
  idempotencyKeyTtlSeconds: number;
  invitationBaseUrl: string;
  mailProvider: 'log' | 'smtp';
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  smtpSecure: boolean;
  mailFrom: string;
}

export function loadConfig(input: NodeJS.ProcessEnv = process.env): AppConfig {
  const environment = environmentSchema.parse(input);
  const corsOrigins =
    environment.CORS_ORIGIN === '*'
      ? '*'
      : environment.CORS_ORIGIN.split(',')
          .map((origin) => origin.trim())
          .filter(Boolean);

  return {
    nodeEnv: environment.NODE_ENV,
    port: environment.PORT,
    databaseUrl: environment.DATABASE_URL,
    logLevel: environment.LOG_LEVEL,
    corsOrigins,
    trustProxy: environment.TRUST_PROXY,
    apiRateLimitWindowSeconds: environment.RATE_LIMIT_API_WINDOW_SECONDS,
    apiRateLimitMaxRequests: environment.RATE_LIMIT_API_MAX_REQUESTS,
    appleAuthRateLimitWindowSeconds: environment.RATE_LIMIT_APPLE_AUTH_WINDOW_SECONDS,
    appleAuthRateLimitMaxRequests: environment.RATE_LIMIT_APPLE_AUTH_MAX_REQUESTS,
    refreshAuthRateLimitWindowSeconds: environment.RATE_LIMIT_REFRESH_AUTH_WINDOW_SECONDS,
    refreshAuthRateLimitMaxRequests: environment.RATE_LIMIT_REFRESH_AUTH_MAX_REQUESTS,
    appleClientId: environment.APPLE_CLIENT_ID,
    accessTokenSecret: environment.AUTH_ACCESS_TOKEN_SECRET,
    refreshTokenSecret: environment.AUTH_REFRESH_TOKEN_SECRET,
    accessTokenTtlSeconds: environment.AUTH_ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTtlSeconds: environment.AUTH_REFRESH_TOKEN_TTL_SECONDS,
    localTestAuthEnabled: environment.LOCAL_TEST_AUTH_ENABLED,
    storageProvider: environment.STORAGE_PROVIDER,
    storageBucket: environment.STORAGE_BUCKET,
    storageRegion: environment.STORAGE_REGION,
    storageEndpoint: environment.STORAGE_ENDPOINT,
    storageAccessKeyId: environment.STORAGE_ACCESS_KEY_ID,
    storageSecretAccessKey: environment.STORAGE_SECRET_ACCESS_KEY,
    storageUseSsl: environment.STORAGE_USE_SSL,
    storageUploadUrlTtlSeconds: environment.STORAGE_UPLOAD_URL_TTL_SECONDS,
    storageDownloadUrlTtlSeconds: environment.STORAGE_DOWNLOAD_URL_TTL_SECONDS,
    assetMinModelSizeBytes: environment.ASSET_MIN_MODEL_SIZE_BYTES,
    assetMaxModelSizeBytes: environment.ASSET_MAX_MODEL_SIZE_BYTES,
    assetMaxThumbnailSizeBytes: environment.ASSET_MAX_THUMBNAIL_SIZE_BYTES,
    invitationTtlSeconds: environment.INVITATION_TTL_SECONDS,
    idempotencyKeyTtlSeconds: environment.IDEMPOTENCY_KEY_TTL_SECONDS,
    invitationBaseUrl: environment.INVITATION_BASE_URL,
    mailProvider: environment.MAIL_PROVIDER,
    smtpHost: environment.SMTP_HOST,
    smtpPort: environment.SMTP_PORT,
    smtpUser: environment.SMTP_USER,
    smtpPass: environment.SMTP_PASS,
    smtpSecure: environment.SMTP_SECURE,
    mailFrom: environment.MAIL_FROM,
  };
}
