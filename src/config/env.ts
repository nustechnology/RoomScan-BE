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
    APPLE_CLIENT_ID: z.string().trim().min(1).max(255),
    AUTH_ACCESS_TOKEN_SECRET: z.string().min(32),
    AUTH_REFRESH_TOKEN_SECRET: z.string().min(32),
    AUTH_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
    AUTH_REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),
    LOCAL_TEST_AUTH_ENABLED: environmentBooleanSchema,
    STORAGE_PROVIDER: z.string().trim().min(1).default('local'),
    STORAGE_BUCKET: z.string().trim().default(''),
    STORAGE_REGION: z.string().trim().default(''),
    STORAGE_ENDPOINT: z.string().trim().default(''),
    STORAGE_UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    STORAGE_DOWNLOAD_URL_TTL_SECONDS: z.coerce.number().int().positive().default(60),
    ASSET_MAX_MODEL_SIZE_BYTES: z.coerce.number().int().positive().default(500_000_000),
    ASSET_MAX_THUMBNAIL_SIZE_BYTES: z.coerce.number().int().positive().default(10_000_000),
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
  storageUploadUrlTtlSeconds: number;
  storageDownloadUrlTtlSeconds: number;
  assetMaxModelSizeBytes: number;
  assetMaxThumbnailSizeBytes: number;
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
    storageUploadUrlTtlSeconds: environment.STORAGE_UPLOAD_URL_TTL_SECONDS,
    storageDownloadUrlTtlSeconds: environment.STORAGE_DOWNLOAD_URL_TTL_SECONDS,
    assetMaxModelSizeBytes: environment.ASSET_MAX_MODEL_SIZE_BYTES,
    assetMaxThumbnailSizeBytes: environment.ASSET_MAX_THUMBNAIL_SIZE_BYTES,
  };
}
