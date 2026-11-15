import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { serverEnv } from '../config/env.ts';

export interface CorsConfig {
  allowedSet: Set<string>;
  allowVercelPreviews: boolean;
  vercelPreviewProjectSlug: string;
}

export function normalizeOrigin(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '*') return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildAllowedOriginSet(params: {
  appUrl?: string;
  corsAllowedOrigins?: string[];
  nodeEnv?: string;
}): Set<string> {
  const set = new Set<string>();

  for (const rawOrigin of params.corsAllowedOrigins || []) {
    const normalized = normalizeOrigin(rawOrigin);
    if (normalized) {
      set.add(normalized);
    }
  }

  if (params.appUrl) {
    const normalizedApp = normalizeOrigin(params.appUrl);
    if (normalizedApp) {
      set.add(normalizedApp);
    }
  }

  if (params.nodeEnv !== 'production') {
    set.add('http://localhost:3000');
    set.add('http://127.0.0.1:3000');
    set.add('http://localhost:5173');
    set.add('http://127.0.0.1:5173');
  }

  return set;
}

export function isOriginAllowed(origin: string, config: CorsConfig): boolean {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  if (config.allowedSet.has(normalized)) {
    return true;
  }

  if (config.allowVercelPreviews && config.vercelPreviewProjectSlug) {
    const slugPattern = escapeRegExp(config.vercelPreviewProjectSlug);
    const previewRegex = new RegExp(`^https://${slugPattern}(-[a-z0-9-]+)?\\.vercel\\.app$`, 'i');
    return previewRegex.test(normalized);
  }

  return false;
}

function resolveRequestOrigin(req: Request): string | null {
  const host = req.get('host');
  if (!host) return null;
  const protoHeader = req.get('x-forwarded-proto');
  const protocol = (protoHeader ? protoHeader.split(',')[0].trim() : req.protocol) || 'http';
  return normalizeOrigin(`${protocol}://${host}`);
}

export function createCorsMiddleware(overrides?: Partial<CorsConfig>): RequestHandler {
  const config: CorsConfig = {
    allowedSet:
      overrides?.allowedSet ??
      buildAllowedOriginSet({
        appUrl: serverEnv.appUrl,
        corsAllowedOrigins: serverEnv.corsAllowedOrigins,
        nodeEnv: serverEnv.nodeEnv,
      }),
    allowVercelPreviews:
      overrides?.allowVercelPreviews ?? serverEnv.corsAllowVercelPreviews,
    vercelPreviewProjectSlug:
      overrides?.vercelPreviewProjectSlug ?? serverEnv.vercelPreviewProjectSlug,
  };

  return (req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('Vary', 'Origin');

    const rawOrigin = req.headers.origin;
    if (!rawOrigin || typeof rawOrigin !== 'string') {
      next();
      return;
    }

    const normalizedOrigin = normalizeOrigin(rawOrigin);
    const requestOwnOrigin = resolveRequestOrigin(req);
    const isSameOrigin = Boolean(normalizedOrigin && requestOwnOrigin && normalizedOrigin === requestOwnOrigin);
    const allowed = isSameOrigin || isOriginAllowed(rawOrigin, config);

    if (!allowed || !normalizedOrigin) {
      res.status(403).json({
        ok: false,
        error: 'Origin not allowed by CORS policy.',
      });
      return;
    }

    res.setHeader('Access-Control-Allow-Origin', normalizedOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Scheduler-Secret');
    res.setHeader('Access-Control-Max-Age', '600');

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    next();
  };
}
