import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import { ErrorResponseSchema } from '../../common/schemas/error.js';
import {
  IdempotencyKeyHeaderSchema,
  IfMatchHeaderSchema,
} from '../../common/schemas/request-headers.js';
import { ScanIdParamSchema } from '../scan/scan.schemas.js';
import {
  CreateNoteBodySchema,
  ListNotesQuerySchema,
  MoveNoteBodySchema,
  NoteIdParamSchema,
  NoteListResponseSchema,
  NoteResponseSchema,
  UpdateNoteBodySchema,
} from './note.schemas.js';

export const noteOpenApiRegistry = new OpenAPIRegistry();

const noteResponse = noteOpenApiRegistry.register('NoteResponse', NoteResponseSchema);
const noteListResponse = noteOpenApiRegistry.register('NoteListResponse', NoteListResponseSchema);
const createNoteBody = noteOpenApiRegistry.register('CreateNoteBody', CreateNoteBodySchema);
const updateNoteBody = noteOpenApiRegistry.register('UpdateNoteBody', UpdateNoteBodySchema);
const moveNoteBody = noteOpenApiRegistry.register('MoveNoteBody', MoveNoteBodySchema);
const errorResponse = noteOpenApiRegistry.register('NoteErrorResponse', ErrorResponseSchema);

const bearerAuth = 'BearerAuth';

const rateLimitHeaders = {
  RateLimit: {
    description: 'Current quota state for the applicable rate-limit policies',
    schema: {
      type: 'string' as const,
    },
  },
  'RateLimit-Policy': {
    description: 'Rate-limit policies applied to this request',
    schema: {
      type: 'string' as const,
    },
  },
};

const commonErrorResponses = {
  400: {
    description: 'The request body, path parameters, or query parameters are invalid',
    headers: rateLimitHeaders,
    content: {
      'application/json': {
        schema: errorResponse,
      },
    },
  },
  401: {
    description: 'The access token is missing or invalid, or its subject user no longer exists',
    headers: rateLimitHeaders,
    content: {
      'application/json': {
        schema: errorResponse,
      },
    },
  },
  429: {
    description: 'The client exceeded an API rate limit',
    headers: {
      ...rateLimitHeaders,
      'Retry-After': {
        description: 'Seconds until the client may retry',
        schema: {
          type: 'integer' as const,
          minimum: 0,
        },
      },
    },
    content: {
      'application/json': {
        schema: errorResponse,
      },
    },
  },
  500: {
    description: 'An internal server error occurred',
    headers: rateLimitHeaders,
    content: {
      'application/json': {
        schema: errorResponse,
      },
    },
  },
};

const scanNotFoundResponse = {
  description: 'The scan is missing, deleted, or inaccessible to the current user',
  headers: rateLimitHeaders,
  content: {
    'application/json': {
      schema: errorResponse,
    },
  },
};

const noteNotFoundResponse = {
  description: 'The note is missing, deleted, or inaccessible through its parent scan',
  headers: rateLimitHeaders,
  content: {
    'application/json': {
      schema: errorResponse,
    },
  },
};

const modelVersionMismatchResponse = {
  description: 'The submitted model version does not match the scan model version',
  headers: rateLimitHeaders,
  content: {
    'application/json': {
      schema: errorResponse,
    },
  },
};

const revisionConflictResponse = {
  description: 'The note has changed since the client last read it',
  headers: rateLimitHeaders,
  content: {
    'application/json': {
      schema: errorResponse,
    },
  },
};

const revisionOrModelConflictResponse = {
  description:
    'The note has changed since the client last read it, or the model version does not match the scan model version',
  headers: rateLimitHeaders,
  content: {
    'application/json': {
      schema: errorResponse,
    },
  },
};

noteOpenApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/scans/{scanId}/notes',
  tags: ['Notes'],
  summary: 'Create a note on a scan model as its project Owner',
  security: [{ [bearerAuth]: [] }],
  request: {
    params: ScanIdParamSchema,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: createNoteBody,
        },
      },
    },
    headers: IdempotencyKeyHeaderSchema,
  },
  responses: {
    201: {
      description: 'The note was created',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: noteResponse,
        },
      },
    },
    ...commonErrorResponses,
    404: scanNotFoundResponse,
    409: modelVersionMismatchResponse,
  },
});

noteOpenApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/scans/{scanId}/notes',
  tags: ['Notes'],
  summary: 'List notes for a scan as its Owner or an active Viewer',
  security: [{ [bearerAuth]: [] }],
  request: {
    params: ScanIdParamSchema,
    query: ListNotesQuerySchema,
  },
  responses: {
    200: {
      description: 'A paginated list of notes',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: noteListResponse,
        },
      },
    },
    ...commonErrorResponses,
    404: scanNotFoundResponse,
  },
});

noteOpenApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/notes/{noteId}',
  tags: ['Notes'],
  summary: 'Get note detail as its Owner or an active Viewer of the parent project',
  security: [{ [bearerAuth]: [] }],
  request: {
    params: NoteIdParamSchema,
  },
  responses: {
    200: {
      description: 'The note',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: noteResponse,
        },
      },
    },
    ...commonErrorResponses,
    404: noteNotFoundResponse,
  },
});

noteOpenApiRegistry.registerPath({
  method: 'patch',
  path: '/api/v1/notes/{noteId}',
  tags: ['Notes'],
  summary: 'Partially update note content or color as its project Owner',
  security: [{ [bearerAuth]: [] }],
  request: {
    params: NoteIdParamSchema,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: updateNoteBody,
        },
      },
    },
    headers: IfMatchHeaderSchema,
  },
  responses: {
    200: {
      description: 'The updated note',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: noteResponse,
        },
      },
    },
    ...commonErrorResponses,
    404: noteNotFoundResponse,
    409: revisionConflictResponse,
  },
});

noteOpenApiRegistry.registerPath({
  method: 'patch',
  path: '/api/v1/notes/{noteId}/position',
  tags: ['Notes'],
  summary: 'Move a note to a new 3D position as its project Owner',
  security: [{ [bearerAuth]: [] }],
  request: {
    params: NoteIdParamSchema,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: moveNoteBody,
        },
      },
    },
    headers: IfMatchHeaderSchema,
  },
  responses: {
    200: {
      description: 'The moved note',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: noteResponse,
        },
      },
    },
    ...commonErrorResponses,
    404: noteNotFoundResponse,
    409: revisionOrModelConflictResponse,
  },
});

noteOpenApiRegistry.registerPath({
  method: 'delete',
  path: '/api/v1/notes/{noteId}',
  tags: ['Notes'],
  summary: 'Delete a note as its project Owner',
  security: [{ [bearerAuth]: [] }],
  request: {
    params: NoteIdParamSchema,
  },
  responses: {
    204: {
      description: 'The note was deleted',
      headers: rateLimitHeaders,
    },
    ...commonErrorResponses,
    404: noteNotFoundResponse,
  },
});
