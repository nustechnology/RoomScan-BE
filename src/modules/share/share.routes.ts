import { Router } from 'express';

import { AppError } from '../../common/errors/app-error.js';
import {
  idempotencyErrorToAppError,
  resolveIdempotencyKey,
} from '../../common/idempotency/idempotency.js';
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
import { IdempotencyKeyHeaderSchema } from '../../common/schemas/sync-headers.js';
import { ProjectNotFoundError } from '../project/project.errors.js';
import { ProjectIdParamSchema, type ProjectIdParam } from '../project/project.schemas.js';
import { ScanNotFoundError } from '../scan/scan.errors.js';
import { ScanIdParamSchema, type ScanIdParam } from '../scan/scan.schemas.js';
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
  ScanNotShareableError,
  ShareLinkExpiredError,
  ShareLinkNotFoundError,
  ShareLinkRevokedError,
  ViewerAccessNotFoundError,
} from './share.errors.js';
import type { ShareLinkService } from './share-link.service.js';
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
  ScanShareRevokeParamsSchema,
  ScanSharesListResponseSchema,
  ScanViewerRevokeResponseSchema,
  ProjectShareLinkIdParamSchema,
  ScanShareLinkIdParamSchema,
  ShareLinkCreateResponseSchema,
  ShareLinkListResponseSchema,
  ShareLinkRevokeResponseSchema,
  SharesListResponseSchema,
  ShareRevokeParamsSchema,
  ViewerRevokeResponseSchema,
  type InvitationCreateBody,
  type InvitationIdParam,
  type InvitationTokenParam,
  type ProjectShareLinkIdParam,
  type ScanShareRevokeParams,
  type ScanShareLinkIdParam,
  type ShareRevokeParams,
} from './share.schemas.js';
import type { ShareService } from './share.service.js';

export interface ShareRouterDependencies {
  shareService: ShareService;
  shareLinkService: ShareLinkService;
  accessTokenVerifier: AccessTokenVerifier;
  currentUserRepository: CurrentUserRepository;
}

function mapError(error: unknown): AppError | undefined {
  const idempotencyError = idempotencyErrorToAppError(error);
  if (idempotencyError !== undefined) return idempotencyError;
  if (error instanceof ProjectNotFoundError) {
    return new AppError({
      statusCode: 404,
      code: 'PROJECT_NOT_FOUND',
      message: 'Project was not found',
    });
  }
  if (error instanceof ScanNotFoundError) {
    return new AppError({
      statusCode: 404,
      code: 'SCAN_NOT_FOUND',
      message: 'Scan was not found',
    });
  }
  if (error instanceof InvitationNotFoundError) {
    return new AppError({
      statusCode: 404,
      code: 'INVITATION_NOT_FOUND',
      message: 'Invitation was not found',
    });
  }
  if (error instanceof ShareLinkNotFoundError) {
    return new AppError({
      statusCode: 404,
      code: 'SHARE_LINK_NOT_FOUND',
      message: 'Share link was not found',
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
      message: 'The user already has access to this resource',
    });
  }
  if (error instanceof CannotAcceptOwnInvitationError) {
    return new AppError({
      statusCode: 409,
      code: 'CANNOT_ACCEPT_OWN_INVITATION',
      message: 'The resource owner cannot accept their own invitation',
    });
  }
  if (error instanceof ProjectNotShareableError) {
    return new AppError({
      statusCode: 409,
      code: 'PROJECT_NOT_SHAREABLE',
      message: 'Project is not ready to be shared',
    });
  }
  if (error instanceof ScanNotShareableError) {
    return new AppError({
      statusCode: 409,
      code: 'SCAN_NOT_SHAREABLE',
      message: 'Scan is not ready to be shared',
    });
  }
  if (error instanceof ShareLinkRevokedError) {
    return new AppError({
      statusCode: 409,
      code: 'SHARE_LINK_REVOKED',
      message: 'Share link has been revoked',
    });
  }
  if (error instanceof ShareLinkExpiredError) {
    return new AppError({
      statusCode: 409,
      code: 'SHARE_LINK_EXPIRED',
      message: 'Share link has expired',
    });
  }
  return undefined;
}

export function createShareRouter({
  shareService,
  shareLinkService,
  accessTokenVerifier,
  currentUserRepository,
}: ShareRouterDependencies): Router {
  const router = Router();
  const requireAuth = authenticate(accessTokenVerifier, currentUserRepository);
  const requireOptionalAuth = optionalAuthenticate(accessTokenVerifier, currentUserRepository);

  router.post(
    '/projects/:projectId/invitations',
    requireAuth,
    validateRequest({
      body: InvitationCreateBodySchema,
      params: ProjectIdParamSchema,
      headers: IdempotencyKeyHeaderSchema,
    }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { body, params, headers } = response.locals.validated as {
          body: InvitationCreateBody;
          params: ProjectIdParam;
          headers: { 'Idempotency-Key': string };
        };
        const key = resolveIdempotencyKey(headers['Idempotency-Key']);
        const input = {
          recipientEmail: body.recipientEmail,
          ...(body.expiresInSeconds === undefined
            ? {}
            : { expiresInSeconds: body.expiresInSeconds }),
        };
        const result =
          typeof shareService.createInvitationIdempotently === 'function'
            ? await shareService.createInvitationIdempotently(userId, params.projectId, input, key)
            : {
                body: await shareService.createInvitation(userId, params.projectId, input),
                statusCode: 201,
              };
        const responseBody = InvitationCreateResponseSchema.parse(result.body);

        response.status(result.statusCode).json(responseBody);
      } catch (error) {
        next(mapError(error) ?? error);
      }
    },
  );

  router.post(
    '/scans/:scanId/invitations',
    requireAuth,
    validateRequest({ body: InvitationCreateBodySchema, params: ScanIdParamSchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { body, params } = response.locals.validated as {
          body: InvitationCreateBody;
          params: ScanIdParam;
        };
        const result = await shareService.createScanInvitation(userId, params.scanId, {
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

  router.get(
    '/scans/:scanId/shares',
    requireAuth,
    validateRequest({ params: ScanIdParamSchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { params } = response.locals.validated as { params: ScanIdParam };
        const result = await shareService.listScanShares(userId, params.scanId);
        const responseBody = ScanSharesListResponseSchema.parse(result);

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

  router.delete(
    '/scans/:scanId/shares/:userId',
    requireAuth,
    validateRequest({ params: ScanShareRevokeParamsSchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { params } = response.locals.validated as { params: ScanShareRevokeParams };
        const result = await shareService.revokeScanViewer(userId, params.scanId, params.userId);
        const responseBody = ScanViewerRevokeResponseSchema.parse(result);

        response.status(200).json(responseBody);
      } catch (error) {
        next(mapError(error) ?? error);
      }
    },
  );

  router.post(
    '/projects/:projectId/share-links',
    requireAuth,
    validateRequest({ params: ProjectIdParamSchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { params } = response.locals.validated as { params: ProjectIdParam };
        const result = await shareLinkService.createShareLink(userId, {
          projectId: params.projectId,
        });
        const responseBody = ShareLinkCreateResponseSchema.parse(result);

        response.status(201).json(responseBody);
      } catch (error) {
        next(mapError(error) ?? error);
      }
    },
  );

  router.post(
    '/scans/:scanId/share-links',
    requireAuth,
    validateRequest({ params: ScanIdParamSchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { params } = response.locals.validated as { params: ScanIdParam };
        const result = await shareLinkService.createShareLink(userId, { scanId: params.scanId });
        const responseBody = ShareLinkCreateResponseSchema.parse(result);

        response.status(201).json(responseBody);
      } catch (error) {
        next(mapError(error) ?? error);
      }
    },
  );

  router.get(
    '/projects/:projectId/share-links',
    requireAuth,
    validateRequest({ params: ProjectIdParamSchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { params } = response.locals.validated as { params: ProjectIdParam };
        const result = await shareLinkService.listShareLinks(userId, {
          projectId: params.projectId,
        });
        const responseBody = ShareLinkListResponseSchema.parse({ items: result });

        response.status(200).json(responseBody);
      } catch (error) {
        next(mapError(error) ?? error);
      }
    },
  );

  router.get(
    '/scans/:scanId/share-links',
    requireAuth,
    validateRequest({ params: ScanIdParamSchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { params } = response.locals.validated as { params: ScanIdParam };
        const result = await shareLinkService.listShareLinks(userId, { scanId: params.scanId });
        const responseBody = ShareLinkListResponseSchema.parse({ items: result });

        response.status(200).json(responseBody);
      } catch (error) {
        next(mapError(error) ?? error);
      }
    },
  );

  router.delete(
    '/projects/:projectId/share-links/:shareLinkId',
    requireAuth,
    validateRequest({ params: ProjectShareLinkIdParamSchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { params } = response.locals.validated as { params: ProjectShareLinkIdParam };
        const result = await shareLinkService.revokeShareLink(userId, params.shareLinkId);
        const responseBody = ShareLinkRevokeResponseSchema.parse(result);

        response.status(200).json(responseBody);
      } catch (error) {
        next(mapError(error) ?? error);
      }
    },
  );

  router.delete(
    '/scans/:scanId/share-links/:shareLinkId',
    requireAuth,
    validateRequest({ params: ScanShareLinkIdParamSchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { params } = response.locals.validated as { params: ScanShareLinkIdParam };
        const result = await shareLinkService.revokeShareLink(userId, params.shareLinkId);
        const responseBody = ShareLinkRevokeResponseSchema.parse(result);

        response.status(200).json(responseBody);
      } catch (error) {
        next(mapError(error) ?? error);
      }
    },
  );

  return router;
}
