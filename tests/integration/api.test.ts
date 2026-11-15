import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../server.ts';

describe('Express API Integration & Auth Boundary Tests', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = createApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      throw new Error('Failed to bind ephemeral port for API tests');
    }
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('GET /health returns 200 OK with security headers and honest emailMode', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');

    const body = (await res.json()) as { ok: boolean; service: string; emailMode: string };
    expect(body.ok).toBe(true);
    expect(body.service).toBe('carebridge-api');
    expect(['test', 'smtp']).toContain(body.emailMode);
  });

  it('rejects unauthenticated requests to protected notification, assistant, and translate routes with 401', async () => {
    const protectedEndpoints = [
      '/api/notifications/dispatch',
      '/api/assistant',
      '/api/translate',
    ];

    for (const endpoint of protectedEndpoints) {
      const res = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status, `Expected 401 on ${endpoint}`).toBe(401);
      const data = (await res.json()) as { ok: boolean };
      expect(data.ok).toBe(false);
    }
  });

  it('rejects invalid bearer tokens on protected routes with 401', async () => {
    const res = await fetch(`${baseUrl}/api/assistant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer forged.invalid.jwt.token',
      },
      body: JSON.stringify({ question: 'Hello', languageName: 'English' }),
    });
    expect(res.status).toBe(401);
  });

  it('disables x-powered-by and returns JSON 404 for unknown /api/* routes', async () => {
    const res = await fetch(`${baseUrl}/api/nonexistent-carebridge-route`);
    expect(res.status).toBe(404);
    expect(res.headers.get('x-powered-by')).toBeNull();
    const data = (await res.json()) as { ok: boolean; error: string };
    expect(data.ok).toBe(false);
    expect(data.error).toBe('API endpoint not found.');
  });

  it('protects POST /api/scheduler/reminders against missing or unconfigured X-Scheduler-Secret', async () => {
    const res = await fetch(`${baseUrl}/api/scheduler/reminders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun: true }),
    });
    // 503 if SCHEDULER_SECRET is unset in env, or 401 if secret is configured and header is omitted
    expect([401, 503]).toContain(res.status);
  });
});
