import { Router } from 'express';
import {
  getHealthStatus,
  handleCareAssistant,
  handleDispatchNotification,
  handleSchedulerSweep,
  handleTranslateNote,
} from '../controllers/apiController.ts';
import { handleInternalProcessNotifications } from '../controllers/v1Controller.ts';
import { requireFirebaseAuth, requireSchedulerAuth } from '../middleware/auth.ts';
import { asyncHandler } from '../middleware/errorHandler.ts';
import { sensitiveEndpointLimiter, standardApiLimiter } from '../middleware/rateLimit.ts';
import { v1Router } from './v1Routes.ts';

export const apiRouter = Router();

apiRouter.get('/health', getHealthStatus);

// Complete modular /api/v1 REST API
apiRouter.use('/api/v1', v1Router);

// Cloud Scheduler authenticated background endpoints
apiRouter.post(
  '/internal/scheduler/process-notifications',
  sensitiveEndpointLimiter,
  requireSchedulerAuth,
  asyncHandler(handleInternalProcessNotifications),
);

apiRouter.post(
  '/api/scheduler/reminders',
  sensitiveEndpointLimiter,
  requireSchedulerAuth,
  handleSchedulerSweep,
);

// Existing CareBridge endpoints preserved for full frontend compatibility
apiRouter.post(
  '/api/notifications/dispatch',
  sensitiveEndpointLimiter,
  requireFirebaseAuth,
  handleDispatchNotification,
);

apiRouter.post(
  '/api/assistant',
  standardApiLimiter,
  requireFirebaseAuth,
  handleCareAssistant,
);

apiRouter.post(
  '/api/translate',
  standardApiLimiter,
  requireFirebaseAuth,
  handleTranslateNote,
);

apiRouter.use('/api', (_req, res) => {
  res.status(404).json({ ok: false, error: 'API endpoint not found.' });
});
