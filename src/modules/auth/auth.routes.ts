import { Router } from 'express';

import { AppError } from '../../common/errors/app-error.js';
import { validateRequest } from '../../common/middleware/validate-request.js';
import {
  AppleIdentityProviderUnavailableError,
  InvalidAppleIdentityTokenError,
} from './auth.errors.js';
import {
  AppleSignInRequestSchema,
  AppleSignInResponseSchema,
  type AppleSignInRequest,
} from './auth.schemas.js';
import type { AppleAuthService } from './auth.types.js';

export interface AuthRouterDependencies {
  authService: AppleAuthService;
}

export function createAuthRouter({ authService }: AuthRouterDependencies): Router {
  const router = Router();

  router.post(
    '/auth/apple',
    validateRequest({ body: AppleSignInRequestSchema }),
    async (_request, response, next) => {
      let result: Awaited<ReturnType<AppleAuthService['signInWithApple']>>;

      try {
        const { identityToken, nonce } = (response.locals.validated as { body: AppleSignInRequest })
          .body;
        result = await authService.signInWithApple(identityToken, nonce);
      } catch (error) {
        if (error instanceof InvalidAppleIdentityTokenError) {
          next(
            new AppError({
              statusCode: 401,
              code: 'INVALID_APPLE_IDENTITY_TOKEN',
              message: 'Apple identity token is invalid',
            }),
          );
          return;
        }

        if (error instanceof AppleIdentityProviderUnavailableError) {
          next(
            new AppError({
              statusCode: 503,
              code: 'APPLE_IDENTITY_PROVIDER_UNAVAILABLE',
              message: 'Apple identity provider is unavailable',
            }),
          );
          return;
        }

        next(error);
        return;
      }

      try {
        const body = AppleSignInResponseSchema.parse(result);

        response.status(200).json(body);
      } catch {
        next(
          new AppError({
            statusCode: 500,
            code: 'INTERNAL_SERVER_ERROR',
            message: 'An unexpected error occurred',
          }),
        );
      }
    },
  );

  return router;
}
