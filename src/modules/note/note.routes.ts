import { Router } from 'express';

import { AppError } from '../../common/errors/app-error.js';
import {
  idempotencyErrorToAppError,
  resolveIdempotencyKey,
} from '../../common/idempotency/idempotency.js';
import { authenticate, getUserId } from '../../common/middleware/authenticate.js';
import type {
  AccessTokenVerifier,
  CurrentUserRepository,
} from '../../common/middleware/authenticate.js';
import { validateRequest } from '../../common/middleware/validate-request.js';
import {
  parseIfMatch,
  revisionErrorToAppError,
  setRevisionEtag,
} from '../../common/revision/revision.js';
import { ProjectNotFoundError } from '../project/project.errors.js';
import { ScanIdParamSchema, type ScanIdParam } from '../scan/scan.schemas.js';
import { ScanNotFoundError } from '../scan/scan.errors.js';
import { ModelVersionMismatchError, NoteNotFoundError } from './note.errors.js';
import {
  CreateNoteBodySchema,
  ListNotesQuerySchema,
  MoveNoteBodySchema,
  NoteIdParamSchema,
  NoteListResponseSchema,
  NoteResponseSchema,
  UpdateNoteBodySchema,
  type CreateNoteBody,
  type ListNotesQuery,
  type MoveNoteBody,
  type NoteIdParam,
  type UpdateNoteBody,
} from './note.schemas.js';
import type { NoteService } from './note.service.js';
import type { NoteUpdateInput } from './note.types.js';

export interface NoteRouterDependencies {
  noteService: NoteService;
  accessTokenVerifier: AccessTokenVerifier;
  currentUserRepository: CurrentUserRepository;
}

function mapError(error: unknown): AppError | undefined {
  const commonError = idempotencyErrorToAppError(error) ?? revisionErrorToAppError(error);
  if (commonError !== undefined) return commonError;
  if (error instanceof ScanNotFoundError) {
    return new AppError({ statusCode: 404, code: 'SCAN_NOT_FOUND', message: 'Scan was not found' });
  }
  if (error instanceof ProjectNotFoundError) {
    return new AppError({
      statusCode: 404,
      code: 'PROJECT_NOT_FOUND',
      message: 'Project was not found',
    });
  }
  if (error instanceof NoteNotFoundError) {
    return new AppError({ statusCode: 404, code: 'NOTE_NOT_FOUND', message: 'Note was not found' });
  }
  if (error instanceof ModelVersionMismatchError) {
    return new AppError({
      statusCode: 409,
      code: 'MODEL_VERSION_MISMATCH',
      message: 'Model version does not match the scan model version',
    });
  }
  return undefined;
}

export function createNoteRouter({
  noteService,
  accessTokenVerifier,
  currentUserRepository,
}: NoteRouterDependencies): Router {
  const router = Router();
  const requireAuth = authenticate(accessTokenVerifier, currentUserRepository);

  router.post(
    '/scans/:scanId/notes',
    requireAuth,
    validateRequest({ body: CreateNoteBodySchema, params: ScanIdParamSchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { body, params } = response.locals.validated as {
          body: CreateNoteBody;
          params: ScanIdParam;
        };
        const key = resolveIdempotencyKey(
          typeof request.headers['idempotency-key'] === 'string'
            ? request.headers['idempotency-key']
            : undefined,
        );
        const input = {
          title: body.title,
          content: body.content,
          color: body.color,
          position: body.position,
          orientation: body.orientation === undefined ? null : body.orientation,
          modelVersion: body.modelVersion,
        };
        const result =
          typeof noteService.createIdempotently === 'function'
            ? await noteService.createIdempotently(userId, params.scanId, input, key)
            : { body: await noteService.create(userId, params.scanId, input), statusCode: 201 };
        const responseBody = NoteResponseSchema.parse(result.body);

        setRevisionEtag(response, responseBody.revision);
        response.status(result.statusCode).json(responseBody);
      } catch (error) {
        next(mapError(error) ?? error);
      }
    },
  );

  router.get(
    '/scans/:scanId/notes',
    requireAuth,
    validateRequest({ params: ScanIdParamSchema, query: ListNotesQuerySchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { params, query } = response.locals.validated as {
          params: ScanIdParam;
          query: ListNotesQuery;
        };
        const result = await noteService.list(userId, params.scanId, {
          page: query.page,
          limit: query.limit,
          sort: query.sort,
        });
        const responseBody = NoteListResponseSchema.parse(result);

        response.status(200).json(responseBody);
      } catch (error) {
        next(mapError(error) ?? error);
      }
    },
  );

  router.get(
    '/notes/:noteId',
    requireAuth,
    validateRequest({ params: NoteIdParamSchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { params } = response.locals.validated as { params: NoteIdParam };
        const result = await noteService.getById(userId, params.noteId);
        const responseBody = NoteResponseSchema.parse(result);

        setRevisionEtag(response, responseBody.revision);
        response.status(200).json(responseBody);
      } catch (error) {
        next(mapError(error) ?? error);
      }
    },
  );

  router.patch(
    '/notes/:noteId',
    requireAuth,
    validateRequest({ body: UpdateNoteBodySchema, params: NoteIdParamSchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { body, params } = response.locals.validated as {
          body: UpdateNoteBody;
          params: NoteIdParam;
        };
        const data: NoteUpdateInput = {};
        const expectedRevision = parseIfMatch(
          typeof request.headers['if-match'] === 'string' ? request.headers['if-match'] : undefined,
        );
        if (body.title !== undefined) {
          data.title = body.title;
        }
        if (body.content !== undefined) {
          data.content = body.content;
        }
        if (body.color !== undefined) {
          data.color = body.color;
        }
        const result = await noteService.update(userId, params.noteId, expectedRevision, data);
        const responseBody = NoteResponseSchema.parse(result);

        setRevisionEtag(response, responseBody.revision);
        response.status(200).json(responseBody);
      } catch (error) {
        next(mapError(error) ?? error);
      }
    },
  );

  router.patch(
    '/notes/:noteId/position',
    requireAuth,
    validateRequest({ body: MoveNoteBodySchema, params: NoteIdParamSchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { body, params } = response.locals.validated as {
          body: MoveNoteBody;
          params: NoteIdParam;
        };
        const expectedRevision = parseIfMatch(
          typeof request.headers['if-match'] === 'string' ? request.headers['if-match'] : undefined,
        );
        const result = await noteService.move(userId, params.noteId, expectedRevision, {
          position: body.position,
          orientation: body.orientation === undefined ? null : body.orientation,
          modelVersion: body.modelVersion,
        });
        const responseBody = NoteResponseSchema.parse(result);

        setRevisionEtag(response, responseBody.revision);
        response.status(200).json(responseBody);
      } catch (error) {
        next(mapError(error) ?? error);
      }
    },
  );

  router.delete(
    '/notes/:noteId',
    requireAuth,
    validateRequest({ params: NoteIdParamSchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { params } = response.locals.validated as { params: NoteIdParam };
        const expectedRevision = parseIfMatch(
          typeof request.headers['if-match'] === 'string' ? request.headers['if-match'] : undefined,
        );
        const revision = await noteService.delete(userId, params.noteId, expectedRevision);

        setRevisionEtag(response, revision);
        response.status(204).end();
      } catch (error) {
        next(mapError(error) ?? error);
      }
    },
  );

  return router;
}
