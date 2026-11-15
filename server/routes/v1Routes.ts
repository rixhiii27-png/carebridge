import { type NextFunction, type Request, type Response, Router } from 'express';
import {
  handleCancelAppointment,
  handleCreateAppointment,
  handleCreateCareGroup,
  handleCreateInvitation,
  handleCreateMedication,
  handleDashboardActivity,
  handleDashboardAdherence,
  handleDashboardOverview,
  handleDeactivateMedication,
  handleDeleteMe,
  handleGetAppointment,
  handleGetMe,
  handleGetMedication,
  handleListAppointments,
  handleListCareGroups,
  handleListGroupMembers,
  handleListMedications,
  handleListNotifications,
  handleMarkNotificationRead,
  handleMedicationHistory,
  handleRecordDose,
  handleRedeemInvitation,
  handleRevokeMember,
  handleUpdateAppointment,
  handleUpdateMe,
  handleUpdateMedication,
  handleUpdateMemberPermissions,
  handleUpdateNotificationPrefs,
} from '../controllers/v1Controller.ts';
import { requireFirebaseAuth } from '../middleware/auth.ts';
import { AppError, asyncHandler } from '../middleware/errorHandler.ts';
import { sensitiveEndpointLimiter, standardApiLimiter } from '../middleware/rateLimit.ts';
import { validateBody, validateParams, validateQuery } from '../middleware/validation.ts';
import { voiceRouter } from './voiceRoutes.ts';
import {
  createAppointmentSchema,
  createCareGroupSchema,
  createInvitationSchema,
  createMedicationSchema,
  dashboardAdherenceQuerySchema,
  dashboardOverviewQuerySchema,
  groupMemberParamsSchema,
  groupScopedQuerySchema,
  idParamSchema,
  medicationHistoryQuerySchema,
  notificationsQuerySchema,
  recordDoseSchema,
  redeemInvitationSchema,
  updateAppointmentSchema,
  updateMedicationSchema,
  updateMemberPermissionsSchema,
  updateUserMeSchema,
  updateNotificationPreferencesSchema,
} from '../validators/v1Schemas.ts';

export const v1Router = Router();

// All /api/v1 endpoints require verified Firebase authentication
v1Router.use(standardApiLimiter);
v1Router.use(requireFirebaseAuth);
v1Router.use('/voice', voiceRouter);

function blockSelfRoleEscalation(req: Request, _res: Response, next: NextFunction): void {
  if (req.body && typeof req.body === 'object' && 'role' in req.body) {
    next(
      AppError.forbidden(
        'Forbidden: self role escalation is not permitted.',
        'ROLE_ESCALATION_FORBIDDEN',
      ),
    );
    return;
  }
  next();
}

// Users
v1Router.get('/users/me', asyncHandler(handleGetMe));
v1Router.patch(
  '/users/me',
  blockSelfRoleEscalation,
  validateBody(updateUserMeSchema),
  asyncHandler(handleUpdateMe),
);
v1Router.delete('/users/me', sensitiveEndpointLimiter, asyncHandler(handleDeleteMe));

// Care Groups & Invitations
v1Router.get('/care-groups', asyncHandler(handleListCareGroups));
v1Router.post(
  '/care-groups',
  validateBody(createCareGroupSchema),
  asyncHandler(handleCreateCareGroup),
);
v1Router.get(
  '/care-groups/:id/members',
  validateParams(idParamSchema),
  asyncHandler(handleListGroupMembers),
);
v1Router.post(
  '/care-groups/:id/invitations',
  sensitiveEndpointLimiter,
  validateParams(idParamSchema),
  validateBody(createInvitationSchema),
  asyncHandler(handleCreateInvitation),
);
v1Router.post(
  '/invitations/redeem',
  sensitiveEndpointLimiter,
  validateBody(redeemInvitationSchema),
  asyncHandler(handleRedeemInvitation),
);
v1Router.patch(
  '/care-groups/:id/members/:uid',
  sensitiveEndpointLimiter,
  validateParams(groupMemberParamsSchema),
  validateBody(updateMemberPermissionsSchema),
  asyncHandler(handleUpdateMemberPermissions),
);
v1Router.delete(
  '/care-groups/:id/members/:uid',
  sensitiveEndpointLimiter,
  validateParams(groupMemberParamsSchema),
  asyncHandler(handleRevokeMember),
);

// Medications & Doses
v1Router.get(
  '/medications',
  validateQuery(groupScopedQuerySchema),
  asyncHandler(handleListMedications),
);
v1Router.post(
  '/medications',
  validateBody(createMedicationSchema),
  asyncHandler(handleCreateMedication),
);
v1Router.get(
  '/medications/:id',
  validateParams(idParamSchema),
  asyncHandler(handleGetMedication),
);
v1Router.patch(
  '/medications/:id',
  validateParams(idParamSchema),
  validateBody(updateMedicationSchema),
  asyncHandler(handleUpdateMedication),
);
v1Router.delete(
  '/medications/:id',
  validateParams(idParamSchema),
  asyncHandler(handleDeactivateMedication),
);
v1Router.post(
  '/medications/:id/doses',
  validateParams(idParamSchema),
  validateBody(recordDoseSchema),
  asyncHandler(handleRecordDose),
);
v1Router.get(
  '/medications/:id/history',
  validateParams(idParamSchema),
  validateQuery(medicationHistoryQuerySchema),
  asyncHandler(handleMedicationHistory),
);

// Appointments
v1Router.get(
  '/appointments',
  validateQuery(groupScopedQuerySchema),
  asyncHandler(handleListAppointments),
);
v1Router.post(
  '/appointments',
  validateBody(createAppointmentSchema),
  asyncHandler(handleCreateAppointment),
);
v1Router.get(
  '/appointments/:id',
  validateParams(idParamSchema),
  asyncHandler(handleGetAppointment),
);
v1Router.patch(
  '/appointments/:id',
  validateParams(idParamSchema),
  validateBody(updateAppointmentSchema),
  asyncHandler(handleUpdateAppointment),
);
v1Router.delete(
  '/appointments/:id',
  validateParams(idParamSchema),
  asyncHandler(handleCancelAppointment),
);

// Notifications & Preferences
v1Router.get(
  '/notifications',
  validateQuery(notificationsQuerySchema),
  asyncHandler(handleListNotifications),
);
v1Router.patch(
  '/notifications/:id/read',
  validateParams(idParamSchema),
  asyncHandler(handleMarkNotificationRead),
);
v1Router.post(
  '/notifications/preferences',
  validateBody(updateNotificationPreferencesSchema),
  asyncHandler(handleUpdateNotificationPrefs),
);

// Dashboard Intelligence
v1Router.get(
  '/dashboard/overview',
  validateQuery(dashboardOverviewQuerySchema),
  asyncHandler(handleDashboardOverview),
);
v1Router.get(
  '/dashboard/adherence',
  validateQuery(dashboardAdherenceQuerySchema),
  asyncHandler(handleDashboardAdherence),
);
v1Router.get(
  '/dashboard/activity',
  validateQuery(groupScopedQuerySchema),
  asyncHandler(handleDashboardActivity),
);
