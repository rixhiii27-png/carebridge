import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { serverEnv } from '../config/env.ts';

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown, code = 'BAD_REQUEST'): AppError {
    return new AppError(400, code, message, details);
  }

  static unauthorized(message = 'Authentication required.', code = 'UNAUTHORIZED'): AppError {
    return new AppError(401, code, message);
  }

  static forbidden(message = 'Forbidden: insufficient permissions.', code = 'FORBIDDEN'): AppError {
    return new AppError(403, code, message);
  }

  static notFound(message = 'Resource not found.', code = 'NOT_FOUND'): AppError {
    return new AppError(404, code, message);
  }

  static conflict(message: string, code = 'CONFLICT'): AppError {
    return new AppError(409, code, message);
  }

  static serviceUnavailable(message: string, code = 'SERVICE_UNAVAILABLE'): AppError {
    return new AppError(503, code, message);
  }
}

export function asyncHandler<TReq extends Request = Request>(
  fn: (req: TReq, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req as TReq, res, next)).catch(next);
  };
}

export function globalErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      ok: false,
      code: err.code,
      error: err.message,
      ...(err.details !== undefined ? { details: err.details } : {}),
    });
    return;
  }

  if (err && typeof err === 'object' && 'type' in err && (err as { type?: string }).type === 'entity.parse.failed') {
    res.status(400).json({
      ok: false,
      code: 'INVALID_JSON',
      error: 'Malformed JSON request body.',
    });
    return;
  }

  const safeMsg = err instanceof Error ? err.message : 'Unknown error';
  console.error('Unhandled API error:', safeMsg);
  res.status(500).json({
    ok: false,
    code: 'INTERNAL_ERROR',
    error: serverEnv.nodeEnv === 'production' ? 'Internal server error.' : `Internal server error: ${safeMsg}`,
  });
}
