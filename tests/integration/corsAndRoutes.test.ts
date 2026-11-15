import http from 'node:http';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../server.ts';
import { createCorsMiddleware } from '../../server/middleware/cors.ts';
import { apiRouter } from '../../server/routes/apiRoutes.ts';

describe('CORS Enforcement & Backend Route Availability Tests', () => {
  let corsServer: http.Server;
  let corsBaseUrl: string;
  let appServer: http.Server;
  let appBaseUrl: string;

  beforeAll(async () => {
    // 1. Dedicated Express instance testing strict production-like CORS allowlist
    const corsApp = express();
    corsApp.use(express.json());
    corsApp.use(
      createCorsMiddleware({
        allowedSet: new Set(['https://carebridge-frontend.vercel.app']),
        allowVercelPreviews: false,
        vercelPreviewProjectSlug: '',
      }),
    );
    corsApp.use(apiRouter);

    corsServer = http.createServer(corsApp);
    await new Promise<void>((resolve) => {
      corsServer.listen(0, '127.0.0.1', () => resolve());
    });
    const corsAddr = corsServer.address();
    if (!corsAddr || typeof corsAddr === 'string') {
      throw new Error('Failed to bind ephemeral port for CORS tests');
    }
    corsBaseUrl = `http://127.0.0.1:${corsAddr.port}`;

    // 2. Full createApp() server verifying all existing routes remain mounted
    const fullApp = createApp();
    appServer = http.createServer(fullApp);
    await new Promise<void>((resolve) => {
      appServer.listen(0, '127.0.0.1', () => resolve());
    });
    const appAddr = appServer.address();
    if (!appAddr || typeof appAddr === 'string') {
      throw new Error('Failed to bind ephemeral port for full app route tests');
    }
    appBaseUrl = `http://127.0.0.1:${appAddr.port}`;
  });

  afterAll(async () => {
    await Promise.all([
      new Promise<void>((resolve, reject) => {
        corsServer.close((err) => (err ? reject(err) : resolve()));
      }),
      new Promise<void>((resolve, reject) => {
        appServer.close((err) => (err ? reject(err) : resolve()));
      }),
    ]);
  });

  it('approves OPTIONS preflight and GET /health for an explicitly allowed Vercel origin', async () => {
    const preflight = await fetch(`${corsBaseUrl}/api/v1/users/me`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://carebridge-frontend.vercel.app',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Authorization, Content-Type',
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(
      'https://carebridge-frontend.vercel.app',
    );
    expect(preflight.headers.get('vary')).toContain('Origin');

    const health = await fetch(`${corsBaseUrl}/health`, {
      headers: { Origin: 'https://carebridge-frontend.vercel.app' },
    });
    expect(health.status).toBe(200);
    expect(health.headers.get('access-control-allow-origin')).toBe(
      'https://carebridge-frontend.vercel.app',
    );
  });

  it('blocks disallowed cross-origin preflight and API requests with 403 and no ACAO header', async () => {
    const preflight = await fetch(`${corsBaseUrl}/api/v1/users/me`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://malicious-site.example.com',
        'Access-Control-Request-Method': 'GET',
      },
    });
    expect(preflight.status).toBe(403);
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull();

    const blocked = await fetch(`${corsBaseUrl}/health`, {
      headers: { Origin: 'https://malicious-site.example.com' },
    });
    expect(blocked.status).toBe(403);
    expect(blocked.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('allows server-to-server requests with no Origin header (health checks & scheduler)', async () => {
    const health = await fetch(`${corsBaseUrl}/health`);
    expect(health.status).toBe(200);
    expect(health.headers.get('vary')).toContain('Origin');
  });

  it('keeps all v1, legacy, voice, and scheduler routes mounted and auth-protected in createApp()', async () => {
    const firebaseProtected = [
      { method: 'GET', path: '/api/v1/users/me' },
      { method: 'GET', path: '/api/v1/care-groups' },
      { method: 'GET', path: '/api/v1/medications?groupId=g1' },
      { method: 'GET', path: '/api/v1/appointments?groupId=g1' },
      { method: 'GET', path: '/api/v1/notifications' },
      { method: 'GET', path: '/api/v1/dashboard/overview?groupId=g1' },
      { method: 'GET', path: '/api/v1/voice/capabilities' },
      { method: 'POST', path: '/api/v1/voice/converse' },
      { method: 'POST', path: '/api/v1/voice/synthesize' },
      { method: 'POST', path: '/api/v1/voice/transcribe' },
      { method: 'POST', path: '/api/v1/voice/execute-action' },
      { method: 'POST', path: '/api/notifications/dispatch' },
      { method: 'POST', path: '/api/assistant' },
      { method: 'POST', path: '/api/translate' },
    ];

    for (const route of firebaseProtected) {
      const res = await fetch(`${appBaseUrl}${route.path}`, {
        method: route.method,
        headers: route.method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
        body: route.method === 'POST' ? JSON.stringify({}) : undefined,
      });
      expect(res.status, `Expected 401 on ${route.method} ${route.path}`).toBe(401);
    }

    const schedulerRoutes = [
      '/api/scheduler/reminders',
      '/internal/scheduler/process-notifications',
    ];
    for (const path of schedulerRoutes) {
      const res = await fetch(`${appBaseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
      });
      expect([401, 503], `Expected scheduler auth guard on ${path}`).toContain(res.status);
    }
  });
});
