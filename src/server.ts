import 'dotenv/config';
import { createApp } from './app.js';
import { createRateLimiters } from './common/middleware/rate-limit.js';
import { loadConfig } from './config/env.js';
import { AppleIdentityTokenVerifier } from './infrastructure/auth/apple-identity-verifier.js';
import { JoseAccessTokenVerifier } from './infrastructure/auth/jose-access-token-verifier.js';
import { JoseAuthTokenIssuer } from './infrastructure/auth/jwt-token-issuer.js';
import { LocalTestAppleIdentityVerifier } from './infrastructure/auth/local-test-apple-identity-verifier.js';
import { createPrismaClient, PrismaDatabase } from './infrastructure/database/prisma.js';
import { PrismaCurrentUserRepository } from './infrastructure/database/prisma-current-user-repository.js';
import { PrismaAppleUserRepository } from './infrastructure/database/prisma-user-repository.js';
import { PrismaProjectRepository } from './infrastructure/database/prisma-project-repository.js';
import { createLogger } from './infrastructure/logging/logger.js';
import { AuthService } from './modules/auth/auth.service.js';
import { ProjectPermissionService } from './modules/project/project.permissions.js';
import { ProjectService } from './modules/project/project.service.js';

const config = loadConfig();
const logger = createLogger(config);
const prismaClient = createPrismaClient(config.databaseUrl);
const database = new PrismaDatabase(prismaClient);
const userRepository = new PrismaAppleUserRepository(prismaClient);
const currentUserRepository = new PrismaCurrentUserRepository(prismaClient);
const projectRepository = new PrismaProjectRepository(prismaClient);
const appleIdentityVerifier = new LocalTestAppleIdentityVerifier({
  delegate: new AppleIdentityTokenVerifier(config.appleClientId),
  enabled: config.nodeEnv === 'development' && config.localTestAuthEnabled,
});
const tokenIssuer = new JoseAuthTokenIssuer({
  accessTokenSecret: config.accessTokenSecret,
  refreshTokenSecret: config.refreshTokenSecret,
  accessTokenTtlSeconds: config.accessTokenTtlSeconds,
  refreshTokenTtlSeconds: config.refreshTokenTtlSeconds,
});
const accessTokenVerifier = new JoseAccessTokenVerifier({
  accessTokenSecret: config.accessTokenSecret,
});
const authService = new AuthService({
  appleIdentityVerifier,
  userRepository,
  tokenIssuer,
});
const projectPermissions = new ProjectPermissionService(projectRepository);
const projectService = new ProjectService({
  repository: projectRepository,
  permissions: projectPermissions,
});
const rateLimiters = createRateLimiters(config, logger);
const app = createApp({
  config,
  database,
  logger,
  authService,
  projectService,
  accessTokenVerifier,
  currentUserRepository,
  rateLimiters,
});

let isShuttingDown = false;

async function shutdown(signal: string, exitCode: number): Promise<void> {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  logger.info({ signal }, 'Shutting down RoomScan API');

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
  });
  await database.disconnect();
  process.exitCode = exitCode;
}

const server = app.listen(config.port, () => {
  logger.info({ port: config.port }, 'RoomScan API is listening');
});

process.once('SIGINT', () => {
  void shutdown('SIGINT', 0);
});
process.once('SIGTERM', () => {
  void shutdown('SIGTERM', 0);
});
process.once('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught exception');
  void shutdown('uncaughtException', 1);
});
process.once('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection');
  void shutdown('unhandledRejection', 1);
});
