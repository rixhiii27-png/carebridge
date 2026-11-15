import type { Request, Response } from 'express';
import { getBackendAuth, getBackendDb } from '../config/backendContext.ts';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { AppError } from '../middleware/errorHandler.ts';
import type { ValidatedRequest } from '../middleware/validation.ts';
import {
  getActivityFeed,
  getAdherenceAnalytics,
  getDashboardOverview,
} from '../modules/analytics/analyticsService.ts';
import {
  cancelAppointmentAdmin,
  createAppointmentAdmin,
  getAppointmentById,
  listAppointments,
  updateAppointmentAdmin,
} from '../modules/appointments/appointmentsService.ts';
import {
  createCareGroupAdmin,
  createInvitationAdmin,
  getGroupMembersAdmin,
  listUserCareGroups,
  redeemInvitationAdmin,
  revokeMemberAdmin,
  updateMemberPermissionsAdmin,
} from '../modules/careGroups/careGroupsService.ts';
import {
  createMedication,
  deactivateMedicationAdmin,
  getMedicationById,
  getMedicationHistory,
  listMedications,
  recordDoseEvent,
  updateMedicationAdmin,
} from '../modules/medications/medicationsService.ts';
import {
  listUserNotifications,
  markNotificationReadAdmin,
  processSchedulerSweep,
  updateNotificationPreferencesAdmin,
} from '../modules/notifications/notificationsModule.ts';
import {
  deleteMyAccount,
  getMyProfile,
  updateMyProfile,
} from '../modules/users/usersService.ts';
import { schedulerTriggerSchema } from '../validators/schemas.ts';

type AuthedValidatedReq<TBody = unknown, TQuery = unknown, TParams = unknown> =
  AuthenticatedRequest & ValidatedRequest<TBody, TQuery, TParams>;

function requireActor(req: AuthenticatedRequest): {
  uid: string;
  email?: string;
  name: string;
} {
  if (!req.user?.uid) {
    throw AppError.unauthorized('Authentication required.');
  }
  return {
    uid: req.user.uid,
    email: req.user.email,
    name: req.user.name || req.user.email?.split('@')[0] || 'CareBridge User',
  };
}

// ============================================================================
// Users
// ============================================================================

export async function handleGetMe(req: AuthenticatedRequest, res: Response): Promise<void> {
  const actor = requireActor(req);
  const data = await getMyProfile(actor.uid, getBackendDb());
  res.status(200).json({ ok: true, ...data });
}

export async function handleUpdateMe(req: AuthedValidatedReq<Record<string, unknown>>, res: Response): Promise<void> {
  const actor = requireActor(req);
  const updated = await updateMyProfile(actor.uid, actor.email, req.validatedBody ?? {}, getBackendDb());
  res.status(200).json({ ok: true, ...updated });
}

export async function handleDeleteMe(req: AuthenticatedRequest, res: Response): Promise<void> {
  const actor = requireActor(req);
  const result = await deleteMyAccount(actor.uid, getBackendDb(), getBackendAuth());
  res.status(200).json({ ok: true, ...result });
}

// ============================================================================
// Care Groups & Invitations
// ============================================================================

export async function handleListCareGroups(req: AuthenticatedRequest, res: Response): Promise<void> {
  const actor = requireActor(req);
  const items = await listUserCareGroups(actor.uid, getBackendDb());
  res.status(200).json({ ok: true, items });
}

export async function handleCreateCareGroup(
  req: AuthedValidatedReq<{
    elderlyName: string;
    elderlyAge: number;
    ownerRole: 'elderly' | 'family' | 'caregiver';
    bloodGroup?: string;
    primaryPhysician?: string;
    primaryClinic?: string;
    timezone: string;
    allergies?: string[];
    conditions?: string[];
  }>,
  res: Response,
): Promise<void> {
  const actor = requireActor(req);
  const body = req.validatedBody!;
  const group = await createCareGroupAdmin(
    {
      ownerUid: actor.uid,
      ownerName: actor.name,
      ...body,
    },
    getBackendDb(),
  );
  res.status(201).json({ ok: true, group });
}

export async function handleListGroupMembers(
  req: AuthedValidatedReq<unknown, unknown, { id: string }>,
  res: Response,
): Promise<void> {
  const actor = requireActor(req);
  const items = await getGroupMembersAdmin(req.validatedParams!.id, actor.uid, getBackendDb());
  res.status(200).json({ ok: true, items });
}

export async function handleCreateInvitation(
  req: AuthedValidatedReq<
    {
      targetRole: 'family' | 'caregiver';
      canEditMedications: boolean;
      canEditAppointments: boolean;
      invitedEmail?: string;
      expiresInHours?: number;
    },
    unknown,
    { id: string }
  >,
  res: Response,
): Promise<void> {
  const actor = requireActor(req);
  const db = getBackendDb();
  const profileData = await getMyProfile(actor.uid, db);
  const invitation = await createInvitationAdmin(
    {
      groupId: req.validatedParams!.id,
      actorUid: actor.uid,
      actorName: profileData.profile?.displayName || actor.name,
      actorRole: profileData.profile?.role || 'elderly',
      ...req.validatedBody!,
    },
    db,
  );
  res.status(201).json({ ok: true, invitation });
}

export async function handleRedeemInvitation(
  req: AuthedValidatedReq<{ token?: string; code?: string; relationship?: string }>,
  res: Response,
): Promise<void> {
  const actor = requireActor(req);
  const db = getBackendDb();
  const profileData = await getMyProfile(actor.uid, db);
  const result = await redeemInvitationAdmin(
    {
      tokenOrCode: req.validatedBody!.token || req.validatedBody!.code || '',
      uid: actor.uid,
      email: actor.email,
      displayName: profileData.profile?.displayName || actor.name,
      relationship: req.validatedBody!.relationship,
    },
    db,
  );
  res.status(200).json({ ok: true, ...result });
}

export async function handleUpdateMemberPermissions(
  req: AuthedValidatedReq<
    { canEditMedications?: boolean; canEditAppointments?: boolean; status?: 'active' | 'revoked' },
    unknown,
    { id: string; uid: string }
  >,
  res: Response,
): Promise<void> {
  const actor = requireActor(req);
  const member = await updateMemberPermissionsAdmin(
    {
      groupId: req.validatedParams!.id,
      targetUid: req.validatedParams!.uid,
      actorUid: actor.uid,
      actorName: actor.name,
      ...req.validatedBody!,
    },
    getBackendDb(),
  );
  res.status(200).json({ ok: true, member });
}

export async function handleRevokeMember(
  req: AuthedValidatedReq<unknown, unknown, { id: string; uid: string }>,
  res: Response,
): Promise<void> {
  const actor = requireActor(req);
  const result = await revokeMemberAdmin(
    {
      groupId: req.validatedParams!.id,
      targetUid: req.validatedParams!.uid,
      actorUid: actor.uid,
      actorName: actor.name,
    },
    getBackendDb(),
  );
  res.status(200).json({ ok: true, ...result });
}

// ============================================================================
// Medications & Dose Events
// ============================================================================

export async function handleListMedications(
  req: AuthedValidatedReq<unknown, { groupId: string; limit: number; offset: number }>,
  res: Response,
): Promise<void> {
  const actor = requireActor(req);
  const q = req.validatedQuery!;
  const result = await listMedications(
    q.groupId,
    actor.uid,
    { limit: q.limit, offset: q.offset },
    getBackendDb(),
  );
  res.status(200).json({ ok: true, ...result });
}

export async function handleCreateMedication(
  req: AuthedValidatedReq<{
    groupId: string;
    name?: string;
    medicationName?: string;
    dosage: string;
    scheduleTimes: string[];
    frequency: 'once_daily' | 'twice_daily' | 'three_times_daily' | 'weekly' | 'as_needed';
    startDate: string;
    endDate?: string;
    instructions?: string;
    prescriberName?: string;
    prescribingClinician?: string;
    prescriberClinic?: string;
  }>,
  res: Response,
): Promise<void> {
  const actor = requireActor(req);
  const medication = await createMedication(
    actor.uid,
    actor.name,
    req.validatedBody!,
    getBackendDb(),
  );
  res.status(201).json({ ok: true, medication });
}

export async function handleGetMedication(
  req: AuthedValidatedReq<unknown, unknown, { id: string }>,
  res: Response,
): Promise<void> {
  const actor = requireActor(req);
  const medication = await getMedicationById(req.validatedParams!.id, actor.uid, getBackendDb());
  res.status(200).json({ ok: true, medication });
}

export async function handleUpdateMedication(
  req: AuthedValidatedReq<Record<string, unknown>, unknown, { id: string }>,
  res: Response,
): Promise<void> {
  const actor = requireActor(req);
  const medication = await updateMedicationAdmin(
    req.validatedParams!.id,
    actor.uid,
    actor.name,
    req.validatedBody!,
    getBackendDb(),
  );
  res.status(200).json({ ok: true, medication });
}

export async function handleDeactivateMedication(
  req: AuthedValidatedReq<unknown, unknown, { id: string }>,
  res: Response,
): Promise<void> {
  const actor = requireActor(req);
  const medication = await deactivateMedicationAdmin(
    req.validatedParams!.id,
    actor.uid,
    actor.name,
    getBackendDb(),
  );
  res.status(200).json({ ok: true, medication });
}

export async function handleRecordDose(
  req: AuthedValidatedReq<
    { scheduledDate: string; scheduledTime: string; status: string; note?: string },
    unknown,
    { id: string }
  >,
  res: Response,
): Promise<void> {
  const actor = requireActor(req);
  const log = await recordDoseEvent(
    {
      medId: req.validatedParams!.id,
      actorUid: actor.uid,
      actorName: actor.name,
      ...req.validatedBody!,
    },
    getBackendDb(),
  );
  res.status(200).json({ ok: true, log });
}

export async function handleMedicationHistory(
  req: AuthedValidatedReq<
    unknown,
    { limit: number; offset: number; fromDate?: string; toDate?: string },
    { id: string }
  >,
  res: Response,
): Promise<void> {
  const actor = requireActor(req);
  const history = await getMedicationHistory(
    req.validatedParams!.id,
    actor.uid,
    req.validatedQuery!,
    getBackendDb(),
  );
  res.status(200).json({ ok: true, ...history });
}

// ============================================================================
// Appointments
// ============================================================================

export async function handleListAppointments(
  req: AuthedValidatedReq<unknown, { groupId: string; limit: number; offset: number }>,
  res: Response,
): Promise<void> {
  const actor = requireActor(req);
  const q = req.validatedQuery!;
  const result = await listAppointments(
    q.groupId,
    actor.uid,
    { limit: q.limit, offset: q.offset },
    getBackendDb(),
  );
  res.status(200).json({ ok: true, ...result });
}

export async function handleCreateAppointment(
  req: AuthedValidatedReq<{
    groupId: string;
    doctorName: string;
    specialty?: string;
    clinicName?: string;
    hospitalName?: string;
    appointmentDate: string;
    appointmentTime: string;
    timezone: string;
    notes?: string;
    reminderMinutesBefore: number;
  }>,
  res: Response,
): Promise<void> {
  const actor = requireActor(req);
  const appointment = await createAppointmentAdmin(
    actor.uid,
    actor.name,
    req.validatedBody!,
    getBackendDb(),
  );
  res.status(201).json({ ok: true, appointment });
}

export async function handleGetAppointment(
  req: AuthedValidatedReq<unknown, unknown, { id: string }>,
  res: Response,
): Promise<void> {
  const actor = requireActor(req);
  const appointment = await getAppointmentById(req.validatedParams!.id, actor.uid, getBackendDb());
  res.status(200).json({ ok: true, appointment });
}

export async function handleUpdateAppointment(
  req: AuthedValidatedReq<Record<string, unknown>, unknown, { id: string }>,
  res: Response,
): Promise<void> {
  const actor = requireActor(req);
  const appointment = await updateAppointmentAdmin(
    req.validatedParams!.id,
    actor.uid,
    actor.name,
    req.validatedBody!,
    getBackendDb(),
  );
  res.status(200).json({ ok: true, appointment });
}

export async function handleCancelAppointment(
  req: AuthedValidatedReq<unknown, unknown, { id: string }>,
  res: Response,
): Promise<void> {
  const actor = requireActor(req);
  const appointment = await cancelAppointmentAdmin(
    req.validatedParams!.id,
    actor.uid,
    actor.name,
    getBackendDb(),
  );
  res.status(200).json({ ok: true, appointment });
}

// ============================================================================
// Notifications & Preferences
// ============================================================================

export async function handleListNotifications(
  req: AuthedValidatedReq<unknown, { limit: number; offset: number; unreadOnly?: boolean }>,
  res: Response,
): Promise<void> {
  const actor = requireActor(req);
  const result = await listUserNotifications(actor.uid, req.validatedQuery!, getBackendDb());
  res.status(200).json({ ok: true, ...result });
}

export async function handleMarkNotificationRead(
  req: AuthedValidatedReq<unknown, unknown, { id: string }>,
  res: Response,
): Promise<void> {
  const actor = requireActor(req);
  const notification = await markNotificationReadAdmin(
    actor.uid,
    req.validatedParams!.id,
    getBackendDb(),
  );
  res.status(200).json({ ok: true, notification });
}

export async function handleUpdateNotificationPrefs(
  req: AuthedValidatedReq<Record<string, unknown>>,
  res: Response,
): Promise<void> {
  const actor = requireActor(req);
  const preferences = await updateNotificationPreferencesAdmin(
    actor.uid,
    req.validatedBody ?? {},
    getBackendDb(),
  );
  res.status(200).json({ ok: true, preferences });
}

// ============================================================================
// Dashboard Analytics & Internal Scheduler
// ============================================================================

export async function handleDashboardOverview(
  req: AuthedValidatedReq<unknown, { groupId: string }>,
  res: Response,
): Promise<void> {
  const actor = requireActor(req);
  const overview = await getDashboardOverview(req.validatedQuery!.groupId, actor.uid, getBackendDb());
  res.status(200).json({ ok: true, ...overview });
}

export async function handleDashboardAdherence(
  req: AuthedValidatedReq<unknown, { groupId: string; period: 'daily' | 'weekly' | 'monthly' }>,
  res: Response,
): Promise<void> {
  const actor = requireActor(req);
  const q = req.validatedQuery!;
  const analytics = await getAdherenceAnalytics(q.groupId, actor.uid, q.period, getBackendDb());
  res.status(200).json({ ok: true, ...analytics });
}

export async function handleDashboardActivity(
  req: AuthedValidatedReq<unknown, { groupId: string; limit: number; offset: number }>,
  res: Response,
): Promise<void> {
  const actor = requireActor(req);
  const q = req.validatedQuery!;
  const feed = await getActivityFeed(
    q.groupId,
    actor.uid,
    { limit: q.limit, offset: q.offset },
    getBackendDb(),
  );
  res.status(200).json({ ok: true, ...feed });
}

export async function handleInternalProcessNotifications(
  req: Request,
  res: Response,
): Promise<void> {
  const parsed = schedulerTriggerSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw AppError.badRequest('Invalid scheduler payload.', parsed.error.flatten());
  }

  const summary = await processSchedulerSweep(
    {
      dryRun: parsed.data.dryRun,
      timezoneOverride:
        typeof req.body?.timezone === 'string' ? parsed.data.timezone : undefined,
    },
    getBackendDb(),
  );

  res.status(200).json({ ok: true, summary });
}
