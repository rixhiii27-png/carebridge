import type { Firestore } from 'firebase-admin/firestore';
import { adminDb, FieldValue } from '../../config/firebase.ts';
import {
  assertActiveMember,
  assertCanEditMedications,
  type CareMemberDoc,
} from '../../middleware/authorization.ts';
import { AppError } from '../../middleware/errorHandler.ts';
import {
  clampPagination,
  clampStr,
  formatTimezoneDateKey,
  generateDocId,
  sanitizeId,
  shiftDateKeyDays,
} from '../../utils/idAndDate.ts';
import { buildLocalizedNotification } from '../localization/notificationLocalizer.ts';

export type MedicationFrequency =
  | 'once_daily'
  | 'twice_daily'
  | 'three_times_daily'
  | 'weekly'
  | 'as_needed';

export type CanonicalDoseStatus = 'not_confirmed' | 'taken' | 'skipped' | 'missed';

export interface MedicationDoc {
  id: string;
  groupId: string;
  memberUids: string[];
  name: string;
  dosage: string;
  scheduleTimes: string[];
  frequency: MedicationFrequency;
  startDate: string;
  endDate?: string;
  instructions?: string;
  prescriberName?: string;
  prescriberClinic?: string;
  active: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface MedicationLogDoc {
  id: string;
  groupId: string;
  memberUids: string[];
  medicationId: string;
  medicationName: string;
  scheduledDate: string;
  scheduledTime: string;
  status: CanonicalDoseStatus;
  note?: string;
  updatedByUid: string;
  updatedByName: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export function normalizeDoseStatus(status: string): CanonicalDoseStatus {
  if (status === 'unconfirmed') return 'not_confirmed';
  if (status === 'taken' || status === 'skipped' || status === 'missed' || status === 'not_confirmed') {
    return status;
  }
  throw AppError.badRequest(`Unsupported dose status: ${status}`);
}

export function deriveScheduledDoseSlots(
  meds: MedicationDoc[],
  logs: MedicationLogDoc[],
  dateKey: string,
): Array<{
  medicationId: string;
  medicationName: string;
  dosage: string;
  scheduledDate: string;
  scheduledTime: string;
  status: CanonicalDoseStatus;
  updatedByName?: string;
}> {
  const logByKey = new Map<string, MedicationLogDoc>();
  for (const log of logs) {
    if (log.scheduledDate === dateKey) {
      logByKey.set(`${log.medicationId}_${log.scheduledTime}`, log);
    }
  }

  const slots: Array<{
    medicationId: string;
    medicationName: string;
    dosage: string;
    scheduledDate: string;
    scheduledTime: string;
    status: CanonicalDoseStatus;
    updatedByName?: string;
  }> = [];

  for (const med of meds) {
    if (!med.active) continue;
    if (med.startDate > dateKey) continue;
    if (med.endDate && med.endDate < dateKey) continue;

    for (const time of med.scheduleTimes) {
      const existing = logByKey.get(`${med.id}_${time}`);
      slots.push({
        medicationId: med.id,
        medicationName: med.name,
        dosage: med.dosage,
        scheduledDate: dateKey,
        scheduledTime: time,
        status: existing ? existing.status : 'not_confirmed',
        updatedByName: existing?.updatedByName,
      });
    }
  }

  slots.sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));
  return slots;
}

export async function listMedications(
  groupId: string,
  actorUid: string,
  options: { limit?: number; offset?: number; activeOnly?: boolean } = {},
  db: Firestore = adminDb,
): Promise<{
  items: MedicationDoc[];
  total: number;
  limit: number;
  offset: number;
  todaySchedule: ReturnType<typeof deriveScheduledDoseSlots>;
}> {
  const { group } = await assertActiveMember(groupId, actorUid, db);
  const { limit, offset } = clampPagination(options.limit, options.offset);

  const [medsSnap, logsSnap] = await Promise.all([
    db.collection('medications').where('groupId', '==', groupId).get(),
    db.collection('medicationLogs').where('groupId', '==', groupId).get(),
  ]);

  let items = medsSnap.docs.map((d) => d.data() as MedicationDoc);
  if (options.activeOnly) {
    items = items.filter((m) => m.active);
  }
  items.sort((a, b) => a.name.localeCompare(b.name));

  const total = items.length;
  const paged = items.slice(offset, offset + limit);
  const todayKey = formatTimezoneDateKey(new Date(), group.timezone || 'Asia/Kolkata');
  const logs = logsSnap.docs.map((d) => d.data() as MedicationLogDoc);
  const todaySchedule = deriveScheduledDoseSlots(items, logs, todayKey);

  return { items: paged, total, limit, offset, todaySchedule };
}

export async function getMedicationById(
  medId: string,
  actorUid: string,
  db: Firestore = adminDb,
): Promise<MedicationDoc> {
  const medSnap = await db.doc(`medications/${medId}`).get();
  if (!medSnap.exists) {
    throw AppError.notFound('Medication not found.');
  }
  const med = medSnap.data() as MedicationDoc;
  await assertActiveMember(med.groupId, actorUid, db);
  return med;
}

export async function createMedication(
  actorUid: string,
  actorName: string,
  payload: {
    groupId: string;
    name?: string;
    medicationName?: string;
    dosage: string;
    scheduleTimes: string[];
    frequency: MedicationFrequency;
    startDate: string;
    endDate?: string;
    instructions?: string;
    prescriberName?: string;
    prescribingClinician?: string;
    prescriberClinic?: string;
  },
  db: Firestore = adminDb,
): Promise<MedicationDoc> {
  const { group, member } = await assertCanEditMedications(payload.groupId, actorUid, db);

  if (payload.endDate && payload.endDate < payload.startDate) {
    throw AppError.badRequest('endDate cannot be earlier than startDate.');
  }

  const medId = generateDocId('med');
  const actId = generateDocId('act');
  const resolvedName = clampStr(payload.name ?? payload.medicationName, 120) || 'Medication';
  const resolvedPrescriber = clampStr(payload.prescriberName ?? payload.prescribingClinician, 120);
  const cleanTimes = Array.from(new Set(payload.scheduleTimes.map((t) => t.trim().slice(0, 5)))).slice(0, 8);

  const medDoc: MedicationDoc = {
    id: medId,
    groupId: payload.groupId,
    memberUids: group.memberUids.slice(0, 20),
    name: resolvedName,
    dosage: clampStr(payload.dosage, 80) || 'As directed',
    scheduleTimes: cleanTimes,
    frequency: payload.frequency,
    startDate: payload.startDate.slice(0, 10),
    active: true,
    createdBy: actorUid,
    updatedBy: actorUid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (payload.endDate) medDoc.endDate = payload.endDate.slice(0, 10);
  if (payload.instructions) medDoc.instructions = clampStr(payload.instructions, 500);
  if (resolvedPrescriber) medDoc.prescriberName = resolvedPrescriber;
  if (payload.prescriberClinic) medDoc.prescriberClinic = clampStr(payload.prescriberClinic, 160);

  const batch = db.batch();
  batch.set(db.doc(`medications/${medId}`), medDoc);
  batch.set(db.doc(`activityLogs/${actId}`), {
    id: actId,
    groupId: payload.groupId,
    memberUids: group.memberUids.slice(0, 20),
    actorUid,
    actorName: clampStr(actorName || member.displayName, 120) || 'Member',
    actorRole: member.role,
    actionType: 'MEDICATION_ADDED',
    entityType: 'medication',
    entityId: medId,
    summary: `Added medication ${resolvedName} (${medDoc.dosage})`,
    createdAt: FieldValue.serverTimestamp(),
  });

  await batch.commit();
  const created = await db.doc(`medications/${medId}`).get();
  return created.data() as MedicationDoc;
}

export async function updateMedicationAdmin(
  medId: string,
  actorUid: string,
  actorName: string,
  patch: {
    name?: string;
    medicationName?: string;
    dosage?: string;
    scheduleTimes?: string[];
    frequency?: MedicationFrequency;
    startDate?: string;
    endDate?: string;
    instructions?: string;
    prescriberName?: string;
    prescribingClinician?: string;
    prescriberClinic?: string;
    active?: boolean;
  },
  db: Firestore = adminDb,
): Promise<MedicationDoc> {
  const medRef = db.doc(`medications/${medId}`);
  const medSnap = await medRef.get();
  if (!medSnap.exists) {
    throw AppError.notFound('Medication not found.');
  }
  const existing = medSnap.data() as MedicationDoc;
  const { group, member } = await assertCanEditMedications(existing.groupId, actorUid, db);

  const nextStart = patch.startDate ?? existing.startDate;
  const nextEnd = patch.endDate ?? existing.endDate;
  if (nextEnd && nextEnd < nextStart) {
    throw AppError.badRequest('endDate cannot be earlier than startDate.');
  }

  const updatePayload: Record<string, unknown> = {
    updatedBy: actorUid,
    memberUids: group.memberUids.slice(0, 20),
    updatedAt: FieldValue.serverTimestamp(),
  };

  const resolvedName = patch.name ?? patch.medicationName;
  if (resolvedName !== undefined) updatePayload.name = clampStr(resolvedName, 120);
  if (patch.dosage !== undefined) updatePayload.dosage = clampStr(patch.dosage, 80);
  if (patch.scheduleTimes !== undefined) {
    updatePayload.scheduleTimes = Array.from(
      new Set(patch.scheduleTimes.map((t) => t.trim().slice(0, 5))),
    ).slice(0, 8);
  }
  if (patch.frequency !== undefined) updatePayload.frequency = patch.frequency;
  if (patch.startDate !== undefined) updatePayload.startDate = patch.startDate.slice(0, 10);
  if (patch.endDate !== undefined) updatePayload.endDate = patch.endDate.slice(0, 10);
  if (patch.instructions !== undefined) updatePayload.instructions = clampStr(patch.instructions, 500);
  const resolvedPrescriber = patch.prescriberName ?? patch.prescribingClinician;
  if (resolvedPrescriber !== undefined) updatePayload.prescriberName = clampStr(resolvedPrescriber, 120);
  if (patch.prescriberClinic !== undefined) {
    updatePayload.prescriberClinic = clampStr(patch.prescriberClinic, 160);
  }
  if (patch.active !== undefined) updatePayload.active = patch.active;

  const actId = generateDocId('act');
  const batch = db.batch();
  batch.update(medRef, updatePayload);
  batch.set(db.doc(`activityLogs/${actId}`), {
    id: actId,
    groupId: existing.groupId,
    memberUids: group.memberUids.slice(0, 20),
    actorUid,
    actorName: clampStr(actorName || member.displayName, 120) || 'Member',
    actorRole: member.role,
    actionType: patch.active === false ? 'MEDICATION_DEACTIVATED' : 'MEDICATION_UPDATED',
    entityType: 'medication',
    entityId: medId,
    summary:
      patch.active === false
        ? `Deactivated medication ${resolvedName ?? existing.name}`
        : `Updated medication ${resolvedName ?? existing.name}`,
    createdAt: FieldValue.serverTimestamp(),
  });

  await batch.commit();
  const updated = await medRef.get();
  return updated.data() as MedicationDoc;
}

export async function deactivateMedicationAdmin(
  medId: string,
  actorUid: string,
  actorName: string,
  db: Firestore = adminDb,
): Promise<MedicationDoc> {
  return updateMedicationAdmin(medId, actorUid, actorName, { active: false }, db);
}

export async function recordDoseEvent(
  params: {
    medId: string;
    actorUid: string;
    actorName: string;
    scheduledDate: string;
    scheduledTime: string;
    status: string;
    note?: string;
  },
  db: Firestore = adminDb,
): Promise<MedicationLogDoc> {
  const normalizedStatus = normalizeDoseStatus(params.status);
  const medRef = db.doc(`medications/${params.medId}`);
  const medSnap = await medRef.get();
  if (!medSnap.exists) {
    throw AppError.notFound('Medication not found.');
  }
  const med = medSnap.data() as MedicationDoc;
  const { group, member } = await assertActiveMember(med.groupId, params.actorUid, db);

  const actorDisplay = clampStr(params.actorName || member.displayName, 120) || 'Member';
  const logId = sanitizeId(
    `dose_${params.medId}_${params.scheduledDate}_${params.scheduledTime.replace(':', '')}`,
  );
  const logRef = db.doc(`medicationLogs/${logId}`);

  const savedLog = await db.runTransaction(async (tx) => {
    const existingSnap = await tx.get(logRef);
    const actId = generateDocId('act');

    if (existingSnap.exists) {
      const updatePayload: Record<string, unknown> = {
        status: normalizedStatus,
        updatedByUid: params.actorUid,
        updatedByName: actorDisplay,
        memberUids: group.memberUids.slice(0, 20),
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (params.note !== undefined) updatePayload.note = clampStr(params.note, 300);
      tx.update(logRef, updatePayload);
    } else {
      const createPayload: MedicationLogDoc = {
        id: logId,
        groupId: med.groupId,
        memberUids: group.memberUids.slice(0, 20),
        medicationId: med.id,
        medicationName: med.name,
        scheduledDate: params.scheduledDate.slice(0, 10),
        scheduledTime: params.scheduledTime.slice(0, 5),
        status: normalizedStatus,
        updatedByUid: params.actorUid,
        updatedByName: actorDisplay,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (params.note) createPayload.note = clampStr(params.note, 300);
      tx.set(logRef, createPayload);
    }

    tx.set(db.doc(`activityLogs/${actId}`), {
      id: actId,
      groupId: med.groupId,
      memberUids: group.memberUids.slice(0, 20),
      actorUid: params.actorUid,
      actorName: actorDisplay,
      actorRole: member.role,
      actionType: 'DOSE_STATUS_RECORDED',
      entityType: 'medicationLog',
      entityId: logId,
      summary: `Marked ${med.name} (${params.scheduledTime}) as ${normalizedStatus}`,
      createdAt: FieldValue.serverTimestamp(),
    });

    const merged: MedicationLogDoc = existingSnap.exists
      ? ({ ...(existingSnap.data() as MedicationLogDoc), status: normalizedStatus, updatedByUid: params.actorUid, updatedByName: actorDisplay } as MedicationLogDoc)
      : {
          id: logId,
          groupId: med.groupId,
          memberUids: group.memberUids.slice(0, 20),
          medicationId: med.id,
          medicationName: med.name,
          scheduledDate: params.scheduledDate.slice(0, 10),
          scheduledTime: params.scheduledTime.slice(0, 5),
          status: normalizedStatus,
          ...(params.note ? { note: clampStr(params.note, 300) } : {}),
          updatedByUid: params.actorUid,
          updatedByName: actorDisplay,
        };

    return merged;
  });

  // Notify active peers if missed or skipped (best-effort in-app alert honoring active status)
  if (normalizedStatus === 'missed' || normalizedStatus === 'skipped') {
    const membersSnap = await db.collection(`careGroups/${med.groupId}/members`).get();
    const peers = membersSnap.docs
      .map((d) => d.data() as CareMemberDoc)
      .filter((m) => m.status === 'active' && m.uid !== params.actorUid)
      .slice(0, 10);

    if (peers.length > 0) {
      const nBatch = db.batch();
      for (const peer of peers) {
        const peerProfileSnap = await db.doc(`users/${peer.uid}`).get();
        const peerProfile = peerProfileSnap.exists
          ? (peerProfileSnap.data() as { preferredLanguage?: string; preferredScript?: string })
          : undefined;

        const localized = buildLocalizedNotification({
          type: normalizedStatus === 'missed' ? 'missed_dose' : 'caregiver_update',
          languageCode: peerProfile?.preferredLanguage,
          preferredScript: peerProfile?.preferredScript,
          medicationName: med.name,
          scheduledTime: params.scheduledTime,
          elderlyName: group.elderlyName,
          summary: `${actorDisplay} marked ${med.name} (${params.scheduledTime}) as ${normalizedStatus}.`,
        });

        const notifId = generateDocId('ntf');
        nBatch.set(db.doc(`notifications/${notifId}`), {
          id: notifId,
          groupId: med.groupId,
          recipientUid: peer.uid,
          type: normalizedStatus === 'missed' ? 'missed_dose' : 'caregiver_update',
          title: localized.title,
          message: localized.message,
          channel: 'in_app',
          deliveryStatus: 'sent',
          dedupeKey: `${logId}_${normalizedStatus}_${peer.uid}`,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      await nBatch.commit();
    }
  }

  return savedLog;
}

export async function getMedicationHistory(
  medId: string,
  actorUid: string,
  options: { limit?: number; offset?: number; fromDate?: string; toDate?: string } = {},
  db: Firestore = adminDb,
): Promise<{ items: MedicationLogDoc[]; total: number; limit: number; offset: number }> {
  const med = await getMedicationById(medId, actorUid, db);
  const { limit, offset } = clampPagination(options.limit, options.offset);

  const snap = await db.collection('medicationLogs').where('medicationId', '==', med.id).get();
  let items = snap.docs.map((d) => d.data() as MedicationLogDoc);

  if (options.fromDate) {
    items = items.filter((l) => l.scheduledDate >= options.fromDate!);
  }
  if (options.toDate) {
    items = items.filter((l) => l.scheduledDate <= options.toDate!);
  }

  items.sort((a, b) =>
    `${b.scheduledDate} ${b.scheduledTime}`.localeCompare(`${a.scheduledDate} ${a.scheduledTime}`),
  );

  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    limit,
    offset,
  };
}

export function computeAdherenceSummary(
  meds: MedicationDoc[],
  logs: MedicationLogDoc[],
  todayDateKey: string,
  daysCount: number,
): {
  taken: number;
  skipped: number;
  missed: number;
  notConfirmed: number;
  totalTracked: number;
  adherencePercent: number;
  series: Array<{
    date: string;
    taken: number;
    skipped: number;
    missed: number;
    notConfirmed: number;
    adherencePercent: number;
  }>;
} {
  const startKey = shiftDateKeyDays(todayDateKey, -(daysCount - 1));
  const seriesMap = new Map<
    string,
    { taken: number; skipped: number; missed: number; notConfirmed: number }
  >();

  for (let i = 0; i < daysCount; i++) {
    seriesMap.set(shiftDateKeyDays(startKey, i), {
      taken: 0,
      skipped: 0,
      missed: 0,
      notConfirmed: 0,
    });
  }

  const loggedKeys = new Set<string>();
  let taken = 0;
  let skipped = 0;
  let missed = 0;
  let notConfirmed = 0;

  for (const log of logs) {
    if (log.scheduledDate < startKey || log.scheduledDate > todayDateKey) continue;
    loggedKeys.add(`${log.medicationId}_${log.scheduledDate}_${log.scheduledTime}`);
    const bucket = seriesMap.get(log.scheduledDate);
    if (log.status === 'taken') {
      taken++;
      if (bucket) bucket.taken++;
    } else if (log.status === 'skipped') {
      skipped++;
      if (bucket) bucket.skipped++;
    } else if (log.status === 'missed') {
      missed++;
      if (bucket) bucket.missed++;
    } else {
      notConfirmed++;
      if (bucket) bucket.notConfirmed++;
    }
  }

  // Count scheduled active medication slots without logs explicitly as notConfirmed (NEVER taken)
  for (const [dateKey, bucket] of seriesMap.entries()) {
    for (const med of meds) {
      if (!med.active || med.startDate > dateKey || (med.endDate && med.endDate < dateKey)) {
        continue;
      }
      for (const time of med.scheduleTimes) {
        const key = `${med.id}_${dateKey}_${time}`;
        if (!loggedKeys.has(key)) {
          notConfirmed++;
          bucket.notConfirmed++;
        }
      }
    }
  }

  const totalTracked = taken + skipped + missed + notConfirmed;
  const adherencePercent = totalTracked > 0 ? Math.round((taken / totalTracked) * 100) : 0;

  const series = Array.from(seriesMap.entries()).map(([date, b]) => {
    const dayTotal = b.taken + b.skipped + b.missed + b.notConfirmed;
    return {
      date,
      ...b,
      adherencePercent: dayTotal > 0 ? Math.round((b.taken / dayTotal) * 100) : 0,
    };
  });

  return {
    taken,
    skipped,
    missed,
    notConfirmed,
    totalTracked,
    adherencePercent,
    series,
  };
}
