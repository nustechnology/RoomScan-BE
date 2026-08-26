import { Router } from 'express';

import { AppError } from '../../common/errors/app-error.js';
import { withErrorMapping } from '../../common/http/route-handler.js';
import { authenticate, getUserId } from '../../common/middleware/authenticate.js';
import type {
  AccessTokenVerifier,
  CurrentUserRepository,
} from '../../common/middleware/authenticate.js';
import { validateRequest } from '../../common/middleware/validate-request.js';
import { UserNotFoundError } from './users.errors.js';
import {
  GetMeResponseSchema,
  UpdateMeBodySchema,
  UserProfileResponseSchema,
  type UpdateMeBody,
} from './users.schemas.js';
import type { UserProfileService } from './users.types.js';

export interface UsersRouterDependencies {
  userProfileService: UserProfileService;
  accessTokenVerifier: AccessTokenVerifier;
  currentUserRepository: CurrentUserRepository;
}

function mapError(error: unknown): AppError | undefined {
  if (error instanceof UserNotFoundError) {
    return new AppError({
      statusCode: 404,
      code: 'USER_NOT_FOUND',
      message: 'User was not found',
    });
  }
  return undefined;
}

const route = withErrorMapping(mapError);

export function createUsersRouter({
  userProfileService,
  accessTokenVerifier,
  currentUserRepository,
}: UsersRouterDependencies): Router {
  const router = Router();
  const requireAuth = authenticate(accessTokenVerifier, currentUserRepository);

  router.get(
    '/users/me',
    requireAuth,
    route(async (request, response) => {
      const userId = getUserId(request);
      const result = await userProfileService.getMe(userId);
      const responseBody = GetMeResponseSchema.parse(result);

      response.status(200).json(responseBody);
    }),
  );

  router.patch(
    '/users/me',
    requireAuth,
    validateRequest({ body: UpdateMeBodySchema }),
    route(async (request, response) => {
      const userId = getUserId(request);
      const { body } = response.locals.validated as { body: UpdateMeBody };
      const result = await userProfileService.updateMe(userId, body);
      const responseBody = UserProfileResponseSchema.parse(result);

      response.status(200).json(responseBody);
    }),
  );

  return router;
}
