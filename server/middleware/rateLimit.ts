import rateLimit from 'express-rate-limit';

export const standardApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { ok: false, error: 'Too many requests. Please wait a moment and try again.' },
});

export const sensitiveEndpointLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 15,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { ok: false, error: 'Rate limit exceeded for sensitive operation.' },
});
