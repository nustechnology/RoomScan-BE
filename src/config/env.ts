import { z } from 'zod';

const postgresUrlSchema = z
  .url()
  .refine((value) => value.startsWith('postgresql://') || value.startsWith('postgres://'), {
    message: 'DATABASE_URL must use the postgresql:// or postgres:// protocol',
  });

export const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    DATABASE_URL: postgresUrlSchema,
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    CORS_ORIGIN: z.string().trim().min(1).default('*'),
    APPLE_CLIENT_ID: z.string().trim().min(1).max(255),
    AUTH_ACCESS_TOKEN_SECRET: z.string().min(32),
    AUTH_REFRESH_TOKEN_SECRET: z.string().min(32),
    AUTH_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    AUTH_REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),
  })
  .superRefine((environment, context) => {
    if (environment.AUTH_REFRESH_TOKEN_TTL_SECONDS <= environment.AUTH_ACCESS_TOKEN_TTL_SECONDS) {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_REFRESH_TOKEN_TTL_SECONDS'],
        message: 'AUTH_REFRESH_TOKEN_TTL_SECONDS must be greater than access token TTL',
      });
    }
  });

export interface AppConfig {
  nodeEnv: z.infer<typeof environmentSchema>['NODE_ENV'];
  port: number;
  databaseUrl: string;
  logLevel: z.infer<typeof environmentSchema>['LOG_LEVEL'];
  corsOrigins: '*' | string[];
  appleClientId: string;
  accessTokenSecret: string;
  refreshTokenSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
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
    appleClientId: environment.APPLE_CLIENT_ID,
    accessTokenSecret: environment.AUTH_ACCESS_TOKEN_SECRET,
    refreshTokenSecret: environment.AUTH_REFRESH_TOKEN_SECRET,
    accessTokenTtlSeconds: environment.AUTH_ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTtlSeconds: environment.AUTH_REFRESH_TOKEN_TTL_SECONDS,
  };
}
