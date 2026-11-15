import type { Firestore } from 'firebase-admin/firestore';
import { adminDb, FieldValue } from '../../config/firebase.ts';
import { assertActiveMember, assertCanEditAppointments } from '../../middleware/authorization.ts';
import { AppError } from '../../middleware/errorHandler.ts';
import {
  clampPagination,
  clampStr,
  formatTimezoneDateKey,
  generateDocId,
  isValidIanaTimezone,
  sanitizeId,
} from '../../utils/idAndDate.ts';

export type AppointmentStatus = 'scheduled' | 'completed' | 'cancelled';

export interface AppointmentDoc {
  id: string;
  groupId: string;
  memberUids: string[];
  doctorName: string;
  specialty?: string;
  clinicName: string;
  appointmentDate: string;
  appointmentTime: string;
  timezone: string;
  notes?: string;
  reminderMinutesBefore: number;
  status: AppointmentStatus;
  createdBy: string;
  updatedBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export async function listAppointments(
  groupId: string,
  actorUid: string,
  options: { limit?: number; offset?: number; status?: AppointmentStatus } = {},
  db: Firestore = adminDb,
): Promise<{ items: AppointmentDoc[]; total: number; limit: number; offset: number }> {
  await assertActiveMember(groupId, actorUid, db);
  const { limit, offset } = clampPagination(options.limit, options.offset);

  const snap = await db.collection('appointments').where('groupId', '==', groupId).get();
  let items = snap.docs.map((d) => d.data() as AppointmentDoc);
  if (options.status) {
    items = items.filter((a) => a.status === options.status);
  }
  items.sort((a, b) =>
    `${a.appointmentDate} ${a.appointmentTime}`.localeCompare(
      `${b.appointmentDate} ${b.appointmentTime}`,
    ),
  );

  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    limit,
    offset,
  };
}

export async function getAppointmentById(
  apptId: string,
  actorUid: string,
  db: Firestore = adminDb,
): Promise<AppointmentDoc> {
  const snap = await db.doc(`appointments/${apptId}`).get();
  if (!snap.exists) {
    throw AppError.notFound('Appointment not found.');
  }
  const appt = snap.data() as AppointmentDoc;
  await assertActiveMember(appt.groupId, actorUid, db);
  return appt;
}

export async function createAppointmentAdmin(
  actorUid: string,
  actorName: string,
  payload: {
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
  },
  db: Firestore = adminDb,
): Promise<AppointmentDoc> {
  const { group, member } = await assertCanEditAppointments(payload.groupId, actorUid, db);

  if (!isValidIanaTimezone(payload.timezone)) {
    throw AppError.badRequest('Invalid appointment timezone.');
  }

  const todayInTz = formatTimezoneDateKey(new Date(), payload.timezone);
  if (payload.appointmentDate < todayInTz) {
    throw AppError.badRequest(
      `Appointment date (${payload.appointmentDate}) cannot be in the past (${todayInTz} in ${payload.timezone}).`,
    );
  }

  const apptId = generateDocId('apt');
  const actId = generateDocId('act');
  const jobId = sanitizeId(`job_apt_${apptId}`);
  const resolvedClinic = clampStr(payload.clinicName ?? payload.hospitalName, 160) || 'Clinic';

  const apptPayload: AppointmentDoc = {
    id: apptId,
    groupId: payload.groupId,
    memberUids: group.memberUids.slice(0, 20),
    doctorName: clampStr(payload.doctorName, 120) || 'Doctor',
    clinicName: resolvedClinic,
    appointmentDate: payload.appointmentDate.slice(0, 10),
    appointmentTime: payload.appointmentTime.slice(0, 5),
    timezone: clampStr(payload.timezone, 64) || 'Asia/Kolkata',
    reminderMinutesBefore: Math.max(0, Math.min(10080, Math.round(payload.reminderMinutesBefore))),
    status: 'scheduled',
    createdBy: actorUid,
    updatedBy: actorUid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (payload.specialty) apptPayload.specialty = clampStr(payload.specialty, 80);
  if (payload.notes) apptPayload.notes = clampStr(payload.notes, 500);

  const batch = db.batch();
  batch.set(db.doc(`appointments/${apptId}`), apptPayload);
  batch.set(db.doc(`notificationJobs/${jobId}`), {
    id: jobId,
    groupId: payload.groupId,
    entityType: 'appointment',
    entityId: apptId,
    scheduledDate: apptPayload.appointmentDate,
    scheduledTime: apptPayload.appointmentTime,
    timezone: apptPayload.timezone,
    reminderMinutesBefore: apptPayload.reminderMinutesBefore,
    status: 'pending',
    attempts: 0,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  batch.set(db.doc(`activityLogs/${actId}`), {
    id: actId,
    groupId: payload.groupId,
    memberUids: group.memberUids.slice(0, 20),
    actorUid,
    actorName: clampStr(actorName || member.displayName, 120) || 'Member',
    actorRole: member.role,
    actionType: 'APPOINTMENT_SCHEDULED',
    entityType: 'appointment',
    entityId: apptId,
    summary: `Scheduled visit with ${apptPayload.doctorName} on ${apptPayload.appointmentDate}`,
    createdAt: FieldValue.serverTimestamp(),
  });

  await batch.commit();
  const created = await db.doc(`appointments/${apptId}`).get();
  return created.data() as AppointmentDoc;
}

export async function updateAppointmentAdmin(
  apptId: string,
  actorUid: string,
  actorName: string,
  patch: {
    doctorName?: string;
    specialty?: string;
    clinicName?: string;
    hospitalName?: string;
    appointmentDate?: string;
    appointmentTime?: string;
    timezone?: string;
    notes?: string;
    reminderMinutesBefore?: number;
    status?: AppointmentStatus;
  },
  db: Firestore = adminDb,
): Promise<AppointmentDoc> {
  const apptRef = db.doc(`appointments/${apptId}`);
  const apptSnap = await apptRef.get();
  if (!apptSnap.exists) {
    throw AppError.notFound('Appointment not found.');
  }
  const existing = apptSnap.data() as AppointmentDoc;
  const { group, member } = await assertCanEditAppointments(existing.groupId, actorUid, db);

  if (existing.status === 'cancelled' && patch.status !== 'cancelled') {
    throw AppError.badRequest('Cancelled appointments cannot be reopened.');
  }

  const updatePayload: Record<string, unknown> = {
    updatedBy: actorUid,
    memberUids: group.memberUids.slice(0, 20),
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (patch.doctorName !== undefined) updatePayload.doctorName = clampStr(patch.doctorName, 120);
  if (patch.specialty !== undefined) updatePayload.specialty = clampStr(patch.specialty, 80);
  const resolvedClinic = patch.clinicName ?? patch.hospitalName;
  if (resolvedClinic !== undefined) updatePayload.clinicName = clampStr(resolvedClinic, 160);
  if (patch.appointmentDate !== undefined) {
    updatePayload.appointmentDate = patch.appointmentDate.slice(0, 10);
  }
  if (patch.appointmentTime !== undefined) {
    updatePayload.appointmentTime = patch.appointmentTime.slice(0, 5);
  }
  if (patch.timezone !== undefined) updatePayload.timezone = clampStr(patch.timezone, 64);
  if (patch.notes !== undefined) updatePayload.notes = clampStr(patch.notes, 500);
  if (patch.reminderMinutesBefore !== undefined) {
    updatePayload.reminderMinutesBefore = Math.max(
      0,
      Math.min(10080, Math.round(patch.reminderMinutesBefore)),
    );
  }
  if (patch.status !== undefined) updatePayload.status = patch.status;

  const jobId = sanitizeId(`job_apt_${apptId}`);
  const actId = generateDocId('act');
  const batch = db.batch();

  batch.update(apptRef, updatePayload);

  const jobRef = db.doc(`notificationJobs/${jobId}`);
  const jobSnap = await jobRef.get();
  if (patch.status === 'cancelled' || patch.status === 'completed') {
    if (jobSnap.exists) {
      batch.update(jobRef, {
        status: patch.status === 'cancelled' ? 'cancelled' : 'completed',
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else if (patch.status === 'cancelled') {
      batch.set(jobRef, {
        id: jobId,
        groupId: existing.groupId,
        entityType: 'appointment',
        entityId: apptId,
        status: 'cancelled',
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  } else if (jobSnap.exists) {
    batch.update(jobRef, {
      scheduledDate: patch.appointmentDate ?? existing.appointmentDate,
      scheduledTime: patch.appointmentTime ?? existing.appointmentTime,
      timezone: patch.timezone ?? existing.timezone,
      reminderMinutesBefore: patch.reminderMinutesBefore ?? existing.reminderMinutesBefore,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  batch.set(db.doc(`activityLogs/${actId}`), {
    id: actId,
    groupId: existing.groupId,
    memberUids: group.memberUids.slice(0, 20),
    actorUid,
    actorName: clampStr(actorName || member.displayName, 120) || 'Member',
    actorRole: member.role,
    actionType: `APPOINTMENT_${(patch.status ?? 'updated').toUpperCase()}`,
    entityType: 'appointment',
    entityId: apptId,
    summary: `Appointment ${patch.status ?? 'updated'} for ${patch.doctorName ?? existing.doctorName}`,
    createdAt: FieldValue.serverTimestamp(),
  });

  await batch.commit();
  const updated = await apptRef.get();
  return updated.data() as AppointmentDoc;
}

export async function cancelAppointmentAdmin(
  apptId: string,
  actorUid: string,
  actorName: string,
  db: Firestore = adminDb,
): Promise<AppointmentDoc> {
  return updateAppointmentAdmin(apptId, actorUid, actorName, { status: 'cancelled' }, db);
}
