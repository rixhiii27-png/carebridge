import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { serverEnv } from './server/config/env.ts';
import { createCorsMiddleware } from './server/middleware/cors.ts';
import { globalErrorHandler } from './server/middleware/errorHandler.ts';
import { apiRouter } from './server/routes/apiRoutes.ts';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use('/api/v1/voice/transcribe', express.json({ limit: '4mb' }));
  app.use(express.json({ limit: '256kb' }));

  // Security headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-XSS-Protection', '0');
    next();
  });

  app.use(createCorsMiddleware());
  app.use(apiRouter);
  app.use(globalErrorHandler);

  return app;
}

async function startServer() {
  const app = createApp();
  const isProd = serverEnv.nodeEnv === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir, { index: false }));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    } else {
      app.get('/', (_req, res) => {
        res.status(200).json({
          ok: true,
          service: 'carebridge-api',
          health: '/health',
        });
      });
    }
  }

  // Centralized error handler
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('Unhandled server error:', err instanceof Error ? err.message : err);
    res.status(500).json({ ok: false, error: 'Internal server error.' });
  });

  app.listen(serverEnv.port, '0.0.0.0', () => {
    console.log(`CareBridge server listening on http://0.0.0.0:${serverEnv.port} (${serverEnv.nodeEnv})`);
  });
}

// Only start listening if executed directly (not imported in unit tests)
const isDirectRun =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  path.basename(process.argv[1] || '') === 'server.ts';

if (isDirectRun) {
  startServer().catch((err) => {
    console.error('Fatal server startup error:', err);
    process.exit(1);
  });
}
