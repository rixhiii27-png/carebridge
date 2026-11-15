import type { NextFunction, Request, Response } from 'express';
import crypto from 'node:crypto';
import { serverEnv } from '../config/env.ts';
import { adminAuth } from '../config/firebase.ts';

export interface VerifiedTokenPayload {
  uid: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

export type TokenVerifierFn = (token: string) => Promise<VerifiedTokenPayload>;
export type OidcVerifierFn = (token: string, expectedAudience: string) => Promise<{
  valid: boolean;
  email?: string;
  emailVerified?: boolean;
  audience?: string;
}>;

let customTokenVerifier: TokenVerifierFn | null = null;
let customOidcVerifier: OidcVerifierFn | null = null;

export function setAuthVerifiersForTests(verifiers: {
  tokenVerifier?: TokenVerifierFn | null;
  oidcVerifier?: OidcVerifierFn | null;
}): void {
  if (verifiers.tokenVerifier !== undefined) {
    customTokenVerifier = verifiers.tokenVerifier;
  }
  if (verifiers.oidcVerifier !== undefined) {
    customOidcVerifier = verifiers.oidcVerifier;
  }
}

export interface AuthenticatedRequest extends Request {
  user?: {
    uid: string;
    email?: string;
    emailVerified: boolean;
    name?: string;
  };
  idToken?: string;
}

export async function requireFirebaseAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ ok: false, error: 'Missing or invalid Authorization header.' });
      return;
    }

    const token = authHeader.slice('Bearer '.length).trim();
    if (!token || token.length > 4096) {
      res.status(401).json({ ok: false, error: 'Invalid authentication token.' });
      return;
    }

    const decoded = customTokenVerifier
      ? await customTokenVerifier(token)
      : await adminAuth.verifyIdToken(token);

    if (!decoded.uid) {
      res.status(401).json({ ok: false, error: 'Token missing subject claim.' });
      return;
    }

    if (decoded.email_verified !== true) {
      res.status(403).json({ ok: false, error: 'Verified email is required for this operation.' });
      return;
    }

    req.user = {
      uid: decoded.uid,
      email: decoded.email,
      emailVerified: decoded.email_verified === true,
      name: typeof decoded.name === 'string' ? decoded.name : undefined,
    };
    req.idToken = token;
    next();
  } catch (err) {
    console.error('Firebase token verification failed:', err instanceof Error ? err.message : 'Unknown error');
    res.status(401).json({ ok: false, error: 'Authentication verification failed.' });
  }
}

async function verifyGoogleOidcToken(token: string, expectedAudience: string): Promise<{
  valid: boolean;
  email?: string;
  emailVerified?: boolean;
  audience?: string;
}> {
  if (customOidcVerifier) {
    return customOidcVerifier(token, expectedAudience);
  }

  const url = new URL('https://oauth2.googleapis.com/tokeninfo');
  url.searchParams.set('id_token', token);
  const response = await fetch(url.toString(), { method: 'GET' });
  if (!response.ok) {
    return { valid: false };
  }

  const claims = (await response.json()) as {
    aud?: string;
    email?: string;
    email_verified?: string | boolean;
    exp?: string;
  };

  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = claims.exp ? Number(claims.exp) : 0;
  const audienceOk = claims.aud === expectedAudience;
  const notExpired = expSec > nowSec;
  const emailVerified = claims.email_verified === true || claims.email_verified === 'true';
  const serviceAcctOk =
    !serverEnv.schedulerOidcServiceAccount ||
    claims.email === serverEnv.schedulerOidcServiceAccount;

  return {
    valid: Boolean(audienceOk && notExpired && emailVerified && serviceAcctOk),
    email: claims.email,
    emailVerified,
    audience: claims.aud,
  };
}

export async function requireSchedulerAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const secret = serverEnv.schedulerSecret;
  const oidcAudience = serverEnv.schedulerOidcAudience;

  if (!secret && !oidcAudience) {
    res.status(503).json({
      ok: false,
      error: 'Cloud Scheduler secret or OIDC audience is not configured on the server.',
    });
    return;
  }

  // Option 1: Cloud Scheduler OIDC Bearer token
  const authHeader = req.headers.authorization;
  if (oidcAudience && authHeader && authHeader.startsWith('Bearer ')) {
    const bearerToken = authHeader.slice('Bearer '.length).trim();
    if (!bearerToken || bearerToken.length > 4096) {
      res.status(403).json({ ok: false, error: 'Invalid scheduler OIDC token.' });
      return;
    }

    try {
      const verification = await verifyGoogleOidcToken(bearerToken, oidcAudience);
      if (!verification.valid) {
        res.status(403).json({ ok: false, error: 'Scheduler OIDC token verification failed.' });
        return;
      }
      next();
      return;
    } catch {
      res.status(403).json({ ok: false, error: 'Unable to validate scheduler OIDC token.' });
      return;
    }
  }

  // Option 2: Shared X-Scheduler-Secret header
  const provided = req.headers['x-scheduler-secret'];
  if (typeof provided !== 'string') {
    res.status(401).json({ ok: false, error: 'Missing X-Scheduler-Secret header or OIDC Bearer token.' });
    return;
  }

  if (!secret) {
    res.status(403).json({ ok: false, error: 'Shared scheduler secret is disabled; provide OIDC Bearer token.' });
    return;
  }

  const expectedBuf = Buffer.from(secret);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length || !crypto.timingSafeEqual(expectedBuf, providedBuf)) {
    res.status(403).json({ ok: false, error: 'Invalid scheduler credential.' });
    return;
  }

  next();
}
