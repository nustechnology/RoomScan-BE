import { z } from 'zod';

const postgresUrlSchema = z
  .string()
  .url()
  .refine((value) => value.startsWith('postgresql://') || value.startsWith('postgres://'), {
    message: 'DATABASE_URL must use the postgresql:// or postgres:// protocol',
  });

export const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: postgresUrlSchema,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGIN: z.string().trim().min(1).default('*'),
});

export interface AppConfig {
  nodeEnv: z.infer<typeof environmentSchema>['NODE_ENV'];
  port: number;
  databaseUrl: string;
  logLevel: z.infer<typeof environmentSchema>['LOG_LEVEL'];
  corsOrigins: '*' | string[];
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
  };
}
