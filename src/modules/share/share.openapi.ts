import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import { ErrorResponseSchema } from '../../common/schemas/error.js';
import { ProjectIdParamSchema } from '../project/project.schemas.js';
import { ScanIdParamSchema } from '../scan/scan.schemas.js';
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
  ShareLinkCreateResponseSchema,
  ShareLinkIdParamSchema,
  ShareLinkListResponseSchema,
  ShareLinkRevokeResponseSchema,
  SharesListResponseSchema,
  ShareRevokeParamsSchema,
  ViewerRevokeResponseSchema,
} from './share.schemas.js';

export const shareOpenApiRegistry = new OpenAPIRegistry();

const bearerAuth = shareOpenApiRegistry.registerComponent('securitySchemes', 'BearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});

const invitationCreateBody = shareOpenApiRegistry.register(
  'InvitationCreateBody',
  InvitationCreateBodySchema,
);
const invitationCreateResponse = shareOpenApiRegistry.register(
  'InvitationCreateResponse',
  InvitationCreateResponseSchema,
);
const invitationResendResponse = shareOpenApiRegistry.register(
  'InvitationResendResponse',
  InvitationResendResponseSchema,
);
const invitationPreviewResponse = shareOpenApiRegistry.register(
  'InvitationPreviewResponse',
  InvitationPreviewResponseSchema,
);
const invitationAcceptResponse = shareOpenApiRegistry.register(
  'InvitationAcceptResponse',
  InvitationAcceptResponseSchema,
);
const invitationDeclineResponse = shareOpenApiRegistry.register(
  'InvitationDeclineResponse',
  InvitationDeclineResponseSchema,
);
const invitationRevokeResponse = shareOpenApiRegistry.register(
  'InvitationRevokeResponse',
  InvitationRevokeResponseSchema,
);
const sharesListResponse = shareOpenApiRegistry.register(
  'SharesListResponse',
  SharesListResponseSchema,
);
const scanSharesListResponse = shareOpenApiRegistry.register(
  'ScanSharesListResponse',
  ScanSharesListResponseSchema,
);
const viewerRevokeResponse = shareOpenApiRegistry.register(
  'ViewerRevokeResponse',
  ViewerRevokeResponseSchema,
);
const scanViewerRevokeResponse = shareOpenApiRegistry.register(
  'ScanViewerRevokeResponse',
  ScanViewerRevokeResponseSchema,
);
const shareLinkCreateResponse = shareOpenApiRegistry.register(
  'ShareLinkCreateResponse',
  ShareLinkCreateResponseSchema,
);
const shareLinkListResponse = shareOpenApiRegistry.register(
  'ShareLinkListResponse',
  ShareLinkListResponseSchema,
);
const shareLinkRevokeResponse = shareOpenApiRegistry.register(
  'ShareLinkRevokeResponse',
  ShareLinkRevokeResponseSchema,
);
const errorResponse = shareOpenApiRegistry.register('ShareErrorResponse', ErrorResponseSchema);

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

const errorResponses = {
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
  403: {
    description: 'Only the project owner can manage sharing',
    headers: rateLimitHeaders,
    content: {
      'application/json': {
        schema: errorResponse,
      },
    },
  },
  404: {
    description:
      'The project, scan, invitation, share link, or viewer access is missing, deleted, or inaccessible',
    headers: rateLimitHeaders,
    content: {
      'application/json': {
        schema: errorResponse,
      },
    },
  },
  409: {
    description:
      'The invitation, share link, or access state is final: already sent to this email, already accepted, expired, revoked, declined, already has access, or the resource is not shareable',
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

shareOpenApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/projects/{projectId}/invitations',
  tags: ['Shares'],
  summary: 'Create an invitation link for a project',
  description:
    'Owner only. The project must have at least one scan with an uploaded model before it can be shared. Sends the invitation email to the recipient.',
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: ProjectIdParamSchema,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: invitationCreateBody,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'The invitation link was created and the email queued',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: invitationCreateResponse,
        },
      },
    },
    ...errorResponses,
  },
});

shareOpenApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/invitations/{invitationId}/resend',
  tags: ['Shares'],
  summary: 'Resend a pending invitation email',
  description:
    'Owner only. Generates a fresh link, extends the expiry, and re-sends the invitation email to the recipient.',
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: InvitationIdParamSchema,
  },
  responses: {
    200: {
      description: 'The invitation email was re-sent and the link refreshed',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: invitationResendResponse,
        },
      },
    },
    ...errorResponses,
  },
});

shareOpenApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/invitations/{token}',
  tags: ['Shares'],
  summary: 'Preview an invitation or share link',
  description:
    'No authentication is required. Resolves either an invitation or a generic share link for a project or scan. When a valid Bearer token is supplied, the response includes whether the current user already has access.',
  security: [{ [bearerAuth.name]: [] }, {}],
  request: {
    params: InvitationTokenParamSchema,
  },
  responses: {
    200: {
      description: 'The invitation or share link and a safe entity summary',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: invitationPreviewResponse,
        },
      },
    },
    400: errorResponses[400],
    404: errorResponses[404],
    429: errorResponses[429],
    500: errorResponses[500],
  },
});

shareOpenApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/invitations/{token}/accept',
  tags: ['Shares'],
  summary: 'Accept an invitation or share link and gain Viewer access',
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: InvitationTokenParamSchema,
  },
  responses: {
    200: {
      description: 'The token was accepted and Viewer access is active',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: invitationAcceptResponse,
        },
      },
    },
    ...errorResponses,
  },
});

shareOpenApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/invitations/{token}/decline',
  tags: ['Shares'],
  summary: 'Decline an invitation for the current user',
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: InvitationTokenParamSchema,
  },
  responses: {
    200: {
      description: 'The invitation was declined',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: invitationDeclineResponse,
        },
      },
    },
    ...errorResponses,
  },
});

shareOpenApiRegistry.registerPath({
  method: 'delete',
  path: '/api/v1/invitations/{invitationId}',
  tags: ['Shares'],
  summary: 'Revoke a pending invitation link',
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: InvitationIdParamSchema,
  },
  responses: {
    200: {
      description: 'The invitation was revoked',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: invitationRevokeResponse,
        },
      },
    },
    ...errorResponses,
  },
});

shareOpenApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/projects/{projectId}/shares',
  tags: ['Shares'],
  summary: 'List pending invitations and accepted Viewers',
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: ProjectIdParamSchema,
  },
  responses: {
    200: {
      description: 'The pending invitations and active Viewers',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: sharesListResponse,
        },
      },
    },
    ...errorResponses,
  },
});

shareOpenApiRegistry.registerPath({
  method: 'delete',
  path: '/api/v1/projects/{projectId}/shares/{userId}',
  tags: ['Shares'],
  summary: 'Revoke Viewer access for a user',
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: ShareRevokeParamsSchema,
  },
  responses: {
    200: {
      description: 'The Viewer access was revoked',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: viewerRevokeResponse,
        },
      },
    },
    ...errorResponses,
  },
});

shareOpenApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/scans/{scanId}/invitations',
  tags: ['Shares'],
  summary: 'Create a scan-scope invitation link',
  description:
    'Owner only. The scan must have an uploaded model before it can be shared. Sends the invitation email to the recipient.',
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: ScanIdParamSchema,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: invitationCreateBody,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'The scan invitation link was created and the email queued',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: invitationCreateResponse,
        },
      },
    },
    ...errorResponses,
  },
});

shareOpenApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/scans/{scanId}/shares',
  tags: ['Shares'],
  summary: 'List scan-scope pending invitations and accepted Viewers',
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: ScanIdParamSchema,
  },
  responses: {
    200: {
      description: 'The pending scan invitations and active scan Viewers',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: scanSharesListResponse,
        },
      },
    },
    ...errorResponses,
  },
});

shareOpenApiRegistry.registerPath({
  method: 'delete',
  path: '/api/v1/scans/{scanId}/shares/{userId}',
  tags: ['Shares'],
  summary: 'Revoke scan Viewer access for a user',
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: ScanShareRevokeParamsSchema,
  },
  responses: {
    200: {
      description: 'The scan Viewer access was revoked',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: scanViewerRevokeResponse,
        },
      },
    },
    ...errorResponses,
  },
});

shareOpenApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/projects/{projectId}/share-links',
  tags: ['Shares'],
  summary: 'Create a generic project share link',
  description:
    'Owner only. The project must have at least one scan with an uploaded model. Creates a reusable link without sending an email.',
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: ProjectIdParamSchema,
  },
  responses: {
    201: {
      description: 'The project share link was created',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: shareLinkCreateResponse,
        },
      },
    },
    ...errorResponses,
  },
});

shareOpenApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/projects/{projectId}/share-links',
  tags: ['Shares'],
  summary: 'List active project share links',
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: ProjectIdParamSchema,
  },
  responses: {
    200: {
      description: 'The active project share links',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: shareLinkListResponse,
        },
      },
    },
    ...errorResponses,
  },
});

shareOpenApiRegistry.registerPath({
  method: 'delete',
  path: '/api/v1/projects/{projectId}/share-links/{shareLinkId}',
  tags: ['Shares'],
  summary: 'Revoke a project share link',
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: ShareLinkIdParamSchema,
  },
  responses: {
    200: {
      description: 'The project share link was revoked',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: shareLinkRevokeResponse,
        },
      },
    },
    ...errorResponses,
  },
});

shareOpenApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/scans/{scanId}/share-links',
  tags: ['Shares'],
  summary: 'Create a generic scan share link',
  description:
    'Owner only. The scan must have an uploaded model. Creates a reusable link without sending an email.',
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: ScanIdParamSchema,
  },
  responses: {
    201: {
      description: 'The scan share link was created',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: shareLinkCreateResponse,
        },
      },
    },
    ...errorResponses,
  },
});

shareOpenApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/scans/{scanId}/share-links',
  tags: ['Shares'],
  summary: 'List active scan share links',
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: ScanIdParamSchema,
  },
  responses: {
    200: {
      description: 'The active scan share links',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: shareLinkListResponse,
        },
      },
    },
    ...errorResponses,
  },
});

shareOpenApiRegistry.registerPath({
  method: 'delete',
  path: '/api/v1/scans/{scanId}/share-links/{shareLinkId}',
  tags: ['Shares'],
  summary: 'Revoke a scan share link',
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: ShareLinkIdParamSchema,
  },
  responses: {
    200: {
      description: 'The scan share link was revoked',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: shareLinkRevokeResponse,
        },
      },
    },
    ...errorResponses,
  },
});
