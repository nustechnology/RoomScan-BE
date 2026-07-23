import pino from 'pino';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createApp } from '../src/app.js';
import { ErrorResponseSchema } from '../src/common/schemas/error.js';
import type { AppConfig } from '../src/config/env.js';
import type { DatabaseHealth } from '../src/infrastructure/database/database.js';
import {
  HealthResponseSchema,
  ReadinessResponseSchema,
} from '../src/modules/health/health.schemas.js';

const config: AppConfig = {
  nodeEnv: 'test',
  port: 3000,
  databaseUrl: 'postgresql://roomscan:roomscan@localhost:5432/roomscan',
  logLevel: 'silent',
  corsOrigins: '*',
};

const clock = () => new Date('2026-07-23T07:00:00.000Z');

describe('RoomScan HTTP application', () => {
  const checkConnection = vi.fn(() => Promise.resolve());
  const disconnect = vi.fn(() => Promise.resolve());
  const database: DatabaseHealth = {
    checkConnection,
    disconnect,
  };
  const logger = pino({ enabled: false });

  const app = createApp({
    config,
    database,
    logger,
    clock,
  });

  beforeEach(() => {
    checkConnection.mockResolvedValue(undefined);
  });

  it('returns liveness without checking the database', async () => {
    const response = await request(app).get('/api/v1/health').expect(200);
    const body = HealthResponseSchema.parse(response.body as unknown);

    expect(body).toEqual({
      status: 'ok',
      service: 'RoomScan',
      version: '0.1.0',
      timestamp: '2026-07-23T07:00:00.000Z',
    });
    expect(checkConnection).not.toHaveBeenCalled();
    expect(response.headers['x-request-id']).toEqual(expect.any(String));
  });

  it('uses the system clock when no clock dependency is supplied', async () => {
    const defaultClockApp = createApp({
      config,
      database,
      logger,
    });
    const response = await request(defaultClockApp).get('/api/v1/health').expect(200);
    const body = HealthResponseSchema.parse(response.body as unknown);

    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  });

  it('preserves an incoming request ID', async () => {
    const response = await request(app)
      .get('/api/v1/health')
      .set('x-request-id', 'roomscan-test-request')
      .expect(200);

    expect(response.headers['x-request-id']).toBe('roomscan-test-request');
  });

  it('returns readiness when PostgreSQL is reachable', async () => {
    const response = await request(app).get('/api/v1/ready').expect(200);
    const body = ReadinessResponseSchema.parse(response.body as unknown);

    expect(checkConnection).toHaveBeenCalledOnce();
    expect(body).toEqual({
      status: 'ok',
      service: 'RoomScan',
      version: '0.1.0',
      timestamp: '2026-07-23T07:00:00.000Z',
      database: 'up',
    });
  });

  it('returns a safe 503 response when PostgreSQL is unavailable', async () => {
    checkConnection.mockRejectedValueOnce(new Error('password=do-not-expose'));

    const response = await request(app).get('/api/v1/ready').expect(503);
    const body = ErrorResponseSchema.parse(response.body as unknown);

    expect(body.error).toEqual({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Database is unavailable',
    });
    expect(body.requestId).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toContain('do-not-expose');
  });

  it('returns the generated OpenAPI 3.1 document', async () => {
    const response = await request(app).get('/api-doc.json').expect(200);
    const body = z
      .object({
        openapi: z.literal('3.1.0'),
        info: z.object({
          title: z.string(),
          version: z.string(),
        }),
        paths: z.record(z.string(), z.unknown()),
      })
      .parse(response.body as unknown);

    expect(body.openapi).toBe('3.1.0');
    expect(body.info).toMatchObject({
      title: 'RoomScan API',
      version: '0.1.0',
    });
    expect(body.paths).toHaveProperty('/api/v1/health');
    expect(body.paths).toHaveProperty('/api/v1/ready');
  });

  it('serves the Swagger UI', async () => {
    const response = await request(app).get('/api-doc/').expect(200);

    expect(response.text).toContain('RoomScan API');
    expect(response.text).toContain('swagger-ui');
  });

  it('returns the standard error envelope for an unknown route', async () => {
    const response = await request(app)
      .get('/missing')
      .set('x-request-id', 'missing-route-request')
      .expect(404);
    const body = ErrorResponseSchema.parse(response.body as unknown);

    expect(body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Route GET /missing was not found',
      },
      requestId: 'missing-route-request',
    });
  });

  it('returns a safe bad-request response for malformed JSON', async () => {
    const response = await request(app)
      .post('/api/v1/health')
      .set('content-type', 'application/json')
      .send('{"broken":')
      .expect(400);
    const body = ErrorResponseSchema.parse(response.body as unknown);

    expect(body.error).toEqual({
      code: 'BAD_REQUEST',
      message: 'Invalid request payload',
    });
    expect(body.requestId).toEqual(expect.any(String));
  });
});
