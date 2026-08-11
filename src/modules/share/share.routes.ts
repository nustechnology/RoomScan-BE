import { Router } from 'express';

import { AppError } from '../../common/errors/app-error.js';
import {
  authenticate,
  getUserId,
  optionalAuthenticate,
} from '../../common/middleware/authenticate.js';
import type {
  AccessTokenVerifier,
  CurrentUserRepository,
} from '../../common/middleware/authenticate.js';
import { validateRequest } from '../../common/middleware/validate-request.js';
import { ProjectNotFoundError } from '../project/project.errors.js';
import { ProjectIdParamSchema, type ProjectIdParam } from '../project/project.schemas.js';
import {
  AccessAlreadyExistsError,
  CannotAcceptOwnInvitationError,
  InvitationAlreadyAcceptedError,
  InvitationAlreadySentError,
  InvitationDeclinedError,
  InvitationExpiredError,
  InvitationNotFoundError,
  InvitationRevokedError,
  NotOwnerError,
  ProjectNotShareableError,
  ViewerAccessNotFoundError,
} from './share.errors.js';
import {
  InvitationAcceptResponseSchema,
  InvitationCreateBodySchema,
  InvitationCreateResponseSchema,
  InvitationDeclineResponseSchema,
  InvitationIdParamSchema,
  InvitationPreviewResponseSchema,
  InvitationResendResponseSchema,
  InvitationRevokeResponseSchema,
  InvitationTokenParamSchema,
  SharesListResponseSchema,
  ShareRevokeParamsSchema,
  ViewerRevokeResponseSchema,
  type InvitationCreateBody,
  type InvitationIdParam,
  type InvitationTokenParam,
  type ShareRevokeParams,
} from './share.schemas.js';
import type { ShareService } from './share.service.js';

export interface ShareRouterDependencies {
  shareService: ShareService;
  accessTokenVerifier: AccessTokenVerifier;
  currentUserRepository: CurrentUserRepository;
}

function mapError(error: unknown): AppError | undefined {
  if (error instanceof ProjectNotFoundError) {
    return new AppError({
      statusCode: 404,
      code: 'PROJECT_NOT_FOUND',
      message: 'Project was not found',
    });
  }
  if (error instanceof InvitationNotFoundError) {
    return new AppError({
      statusCode: 404,
      code: 'INVITATION_NOT_FOUND',
      message: 'Invitation was not found',
    });
  }
  if (error instanceof ViewerAccessNotFoundError) {
    return new AppError({
      statusCode: 404,
      code: 'ACCESS_NOT_FOUND',
      message: 'Viewer access was not found',
    });
  }
  if (error instanceof NotOwnerError) {
    return new AppError({
      statusCode: 403,
      code: 'NOT_OWNER',
      message: 'Only the project owner can manage sharing',
    });
  }
  if (error instanceof InvitationAlreadySentError) {
    return new AppError({
      statusCode: 409,
      code: 'INVITATION_ALREADY_SENT',
      message: 'An invitation has already been sent to this email',
    });
  }
  if (error instanceof InvitationAlreadyAcceptedError) {
    return new AppError({
      statusCode: 409,
      code: 'INVITATION_ALREADY_ACCEPTED',
      message: 'Invitation has already been accepted',
    });
  }
  if (error instanceof InvitationExpiredError) {
    return new AppError({
      statusCode: 409,
      code: 'INVITATION_EXPIRED',
      message: 'Invitation has expired',
    });
  }
  if (error instanceof InvitationRevokedError) {
    return new AppError({
      statusCode: 409,
      code: 'INVITATION_REVOKED',
      message: 'Invitation has been revoked',
    });
  }
  if (error instanceof InvitationDeclinedError) {
    return new AppError({
      statusCode: 409,
      code: 'INVITATION_DECLINED',
      message: 'Invitation has already been declined',
    });
  }
  if (error instanceof AccessAlreadyExistsError) {
    return new AppError({
      statusCode: 409,
      code: 'ACCESS_ALREADY_EXISTS',
      message: 'The user already has access to this project',
    });
  }
  if (error instanceof CannotAcceptOwnInvitationError) {
    return new AppError({
      statusCode: 409,
      code: 'CANNOT_ACCEPT_OWN_INVITATION',
      message: 'The project owner cannot accept their own invitation',
    });
  }
  if (error instanceof ProjectNotShareableError) {
    return new AppError({
      statusCode: 409,
      code: 'PROJECT_NOT_SHAREABLE',
      message: 'Project is not ready to be shared',
    });
  }
  return undefined;
}

export function createShareRouter({
  shareService,
  accessTokenVerifier,
  currentUserRepository,
}: ShareRouterDependencies): Router {
  const router = Router();
  const requireAuth = authenticate(accessTokenVerifier, currentUserRepository);
  const requireOptionalAuth = optionalAuthenticate(accessTokenVerifier, currentUserRepository);

  router.post(
    '/projects/:projectId/invitations',
    requireAuth,
    validateRequest({ body: InvitationCreateBodySchema, params: ProjectIdParamSchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { body, params } = response.locals.validated as {
          body: InvitationCreateBody;
          params: ProjectIdParam;
        };
        const result = await shareService.createInvitation(userId, params.projectId, {
          recipientEmail: body.recipientEmail,
          ...(body.expiresInSeconds === undefined
            ? {}
            : { expiresInSeconds: body.expiresInSeconds }),
        });
        const responseBody = InvitationCreateResponseSchema.parse(result);

        response.status(201).json(responseBody);
      } catch (error) {
        next(mapError(error) ?? error);
      }
    },
  );

  router.post(
    '/invitations/:invitationId/resend',
    requireAuth,
    validateRequest({ params: InvitationIdParamSchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { params } = response.locals.validated as { params: InvitationIdParam };
        const result = await shareService.resendInvitation(userId, params.invitationId);
        const responseBody = InvitationResendResponseSchema.parse(result);

        response.status(200).json(responseBody);
      } catch (error) {
        next(mapError(error) ?? error);
      }
    },
  );

  router.get(
    '/invitations/:token',
    requireOptionalAuth,
    validateRequest({ params: InvitationTokenParamSchema }),
    async (request, response, next) => {
      try {
        const { params } = response.locals.validated as { params: InvitationTokenParam };
        const currentUserId = request.locals?.currentUser?.id;
        const result = await shareService.previewInvitation(params.token, currentUserId);
        const responseBody = InvitationPreviewResponseSchema.parse(result);

        response.status(200).json(responseBody);
      } catch (error) {
        next(mapError(error) ?? error);
      }
    },
  );

  router.post(
    '/invitations/:token/accept',
    requireAuth,
    validateRequest({ params: InvitationTokenParamSchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { params } = response.locals.validated as { params: InvitationTokenParam };
        const result = await shareService.acceptInvitation(userId, params.token);
        const responseBody = InvitationAcceptResponseSchema.parse(result);

        response.status(200).json(responseBody);
      } catch (error) {
        next(mapError(error) ?? error);
      }
    },
  );

  router.post(
    '/invitations/:token/decline',
    requireAuth,
    validateRequest({ params: InvitationTokenParamSchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { params } = response.locals.validated as { params: InvitationTokenParam };
        const result = await shareService.declineInvitation(userId, params.token);
        const responseBody = InvitationDeclineResponseSchema.parse(result);

        response.status(200).json(responseBody);
      } catch (error) {
        next(mapError(error) ?? error);
      }
    },
  );

  router.delete(
    '/invitations/:invitationId',
    requireAuth,
    validateRequest({ params: InvitationIdParamSchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { params } = response.locals.validated as { params: InvitationIdParam };
        const result = await shareService.revokeInvitation(userId, params.invitationId);
        const responseBody = InvitationRevokeResponseSchema.parse(result);

        response.status(200).json(responseBody);
      } catch (error) {
        next(mapError(error) ?? error);
      }
    },
  );

  router.get(
    '/projects/:projectId/shares',
    requireAuth,
    validateRequest({ params: ProjectIdParamSchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { params } = response.locals.validated as { params: ProjectIdParam };
        const result = await shareService.listShares(userId, params.projectId);
        const responseBody = SharesListResponseSchema.parse(result);

        response.status(200).json(responseBody);
      } catch (error) {
        next(mapError(error) ?? error);
      }
    },
  );

  router.delete(
    '/projects/:projectId/shares/:userId',
    requireAuth,
    validateRequest({ params: ShareRevokeParamsSchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { params } = response.locals.validated as { params: ShareRevokeParams };
        const result = await shareService.revokeViewer(userId, params.projectId, params.userId);
        const responseBody = ViewerRevokeResponseSchema.parse(result);

        response.status(200).json(responseBody);
      } catch (error) {
        next(mapError(error) ?? error);
      }
    },
  );

  return router;
}
