import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { AppError } from './errorHandler.ts';

export interface ValidatedRequest<
  TBody = unknown,
  TQuery = unknown,
  TParams = unknown,
> extends Request {
  validatedBody?: TBody;
  validatedQuery?: TQuery;
  validatedParams?: TParams;
}

export function validateBody<T>(schema: ZodType<T>) {
  return (req: ValidatedRequest<T>, _res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      next(AppError.badRequest('Invalid request payload.', parsed.error.flatten(), 'VALIDATION_ERROR'));
      return;
    }
    req.validatedBody = parsed.data;
    next();
  };
}

export function validateQuery<T>(schema: ZodType<T>) {
  return (req: ValidatedRequest<unknown, T>, _res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.query ?? {});
    if (!parsed.success) {
      next(AppError.badRequest('Invalid query parameters.', parsed.error.flatten(), 'VALIDATION_ERROR'));
      return;
    }
    req.validatedQuery = parsed.data;
    next();
  };
}

export function validateParams<T>(schema: ZodType<T>) {
  return (req: ValidatedRequest<unknown, unknown, T>, _res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.params ?? {});
    if (!parsed.success) {
      next(AppError.badRequest('Invalid route parameter.', parsed.error.flatten(), 'VALIDATION_ERROR'));
      return;
    }
    req.validatedParams = parsed.data;
    next();
  };
}
