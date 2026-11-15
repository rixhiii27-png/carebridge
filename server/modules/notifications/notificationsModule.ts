import type { Firestore } from 'firebase-admin/firestore';
import { adminDb, FieldValue } from '../../config/firebase.ts';
import type { CareGroupDoc, CareMemberDoc } from '../../middleware/authorization.ts';
import { AppError } from '../../middleware/errorHandler.ts';
import { sendCareNotificationEmail } from '../../services/emailService.ts';
import { withExponentialRetry } from '../../services/notificationEngine.ts';
import {
  clampPagination,
  clampStr,
  formatTimezoneDateKey,
  formatTimezoneTimeKey,
  generateDocId,
  sanitizeId,
  timeToMinutes,
} from '../../utils/idAndDate.ts';
import type { AppointmentDoc } from '../appointments/appointmentsService.ts';
import {
  buildLocalizedNotification,
  type NotificationCategory,
} from '../localization/notificationLocalizer.ts';
import type { MedicationDoc, MedicationLogDoc } from '../medications/medicationsService.ts';

export interface NotificationPreferenceDoc {
  uid: string;
  inAppEnabled: boolean;
  emailEnabled: boolean;
  upcomingDoseAlert: boolean;
  unconfirmedDoseAlert: boolean;
  missedDoseAlert: boolean;
  appointmentAlert: boolean;
  caregiverUpdateAlert: boolean;
  timezone: string;
  updatedAt?: unknown;
}

const DEFAULT_PREFS = (uid: string, timezone = 'Asia/Kolkata'): NotificationPreferenceDoc => ({
  uid,
  inAppEnabled: true,
  emailEnabled: false,
  upcomingDoseAlert: true,
  unconfirmedDoseAlert: true,
  missedDoseAlert: true,
  appointmentAlert: true,
  caregiverUpdateAlert: true,
  timezone,
});

function isCategoryEnabled(prefs: NotificationPreferenceDoc, category: NotificationCategory): boolean {
  switch (category) {
    case 'upcoming_dose':
      return prefs.upcomingDoseAlert;
    case 'unconfirmed_dose':
      return prefs.unconfirmedDoseAlert;
    case 'missed_dose':
      return prefs.missedDoseAlert;
    case 'upcoming_appointment':
      return prefs.appointmentAlert;
    case 'caregiver_update':
    default:
      return prefs.caregiverUpdateAlert;
  }
}

export async function listUserNotifications(
  uid: string,
  options: { limit?: number; offset?: number; unreadOnly?: boolean } = {},
  db: Firestore = adminDb,
): Promise<{
  items: Array<Record<string, unknown>>;
  unreadCount: number;
  total: number;
  limit: number;
  offset: number;
}> {
  const { limit, offset } = clampPagination(options.limit, options.offset);
  const snap = await db.collection('notifications').where('recipientUid', '==', uid).get();
  let items = snap.docs.map((d) => d.data() as Record<string, unknown>);

  items.sort((a, b) => {
    const ta = (a.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
    const tb = (b.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
    return tb - ta;
  });

  const unreadCount = items.filter((n) => n.read === false).length;
  if (options.unreadOnly) {
    items = items.filter((n) => n.read === false);
  }

  return {
    items: items.slice(offset, offset + limit),
    unreadCount,
    total: items.length,
    limit,
    offset,
  };
}

export async function markNotificationReadAdmin(
  uid: string,
  notifId: string,
  db: Firestore = adminDb,
): Promise<Record<string, unknown>> {
  const ref = db.doc(`notifications/${notifId}`);
  const snap = await ref.get();
  if (!snap.exists) {
    throw AppError.notFound('Notification not found.');
  }
  const data = snap.data() as { recipientUid?: string };
  if (data.recipientUid !== uid) {
    throw AppError.forbidden('Forbidden: you can only modify your own notifications.');
  }

  await ref.update({
    read: true,
    updatedAt: FieldValue.serverTimestamp(),
  });
  const updated = await ref.get();
  return updated.data() as Record<string, unknown>;
}

export async function updateNotificationPreferencesAdmin(
  uid: string,
  patch: Partial<Omit<NotificationPreferenceDoc, 'uid' | 'updatedAt'>>,
  db: Firestore = adminDb,
): Promise<NotificationPreferenceDoc> {
  const ref = db.doc(`notificationPreferences/${uid}`);
  const snap = await ref.get();
  const base = snap.exists
    ? (snap.data() as NotificationPreferenceDoc)
    : DEFAULT_PREFS(uid);

  const next: NotificationPreferenceDoc = {
    uid,
    inAppEnabled: patch.inAppEnabled ?? base.inAppEnabled,
    emailEnabled: patch.emailEnabled ?? base.emailEnabled,
    upcomingDoseAlert: patch.upcomingDoseAlert ?? base.upcomingDoseAlert,
    unconfirmedDoseAlert: patch.unconfirmedDoseAlert ?? base.unconfirmedDoseAlert,
    missedDoseAlert: patch.missedDoseAlert ?? base.missedDoseAlert,
    appointmentAlert: patch.appointmentAlert ?? base.appointmentAlert,
    caregiverUpdateAlert: patch.caregiverUpdateAlert ?? base.caregiverUpdateAlert,
    timezone: clampStr(patch.timezone, 64) || base.timezone || 'Asia/Kolkata',
    updatedAt: FieldValue.serverTimestamp(),
  };

  await ref.set(next, { merge: true });
  const saved = await ref.get();
  return saved.data() as NotificationPreferenceDoc;
}

export interface SweepSummary {
  groupsScanned: number;
  candidatesEvaluated: number;
  delivered: number;
  deduplicated: number;
  skippedByPreference: number;
  skippedCancelled: number;
  testModeLogged: number;
  failed: number;
  dryRun: boolean;
  processedAtIso: string;
}

async function deliverPersistentAlert(
  params: {
    groupId: string;
    recipientUid: string;
    type: NotificationCategory;
    dedupeKey: string;
    elderlyName: string;
    timezone: string;
    medicationName?: string;
    scheduledTime?: string;
    doctorName?: string;
    clinicName?: string;
    appointmentDate?: string;
    appointmentTime?: string;
    dryRun: boolean;
  },
  db: Firestore,
): Promise<'delivered' | 'deduplicated' | 'skipped_preference' | 'test_mode' | 'failed'> {
  const deliveryDocId = sanitizeId(`dlv_${params.dedupeKey}`);
  const deliveryRef = db.doc(`notificationDeliveryLogs/${deliveryDocId}`);
  const existingDelivery = await deliveryRef.get();
  if (existingDelivery.exists) {
    return 'deduplicated';
  }

  const [prefsSnap, userSnap, privateSnap] = await Promise.all([
    db.doc(`notificationPreferences/${params.recipientUid}`).get(),
    db.doc(`users/${params.recipientUid}`).get(),
    db.doc(`users/${params.recipientUid}/private/info`).get(),
  ]);

  const userProfile = userSnap.exists
    ? (userSnap.data() as { preferredLanguage?: string; preferredScript?: string; timezone?: string })
    : undefined;
  const prefs = prefsSnap.exists
    ? (prefsSnap.data() as NotificationPreferenceDoc)
    : DEFAULT_PREFS(params.recipientUid, userProfile?.timezone || params.timezone);

  if (!isCategoryEnabled(prefs, params.type) || (!prefs.inAppEnabled && !prefs.emailEnabled)) {
    if (!params.dryRun) {
      await deliveryRef.set({
        id: deliveryDocId,
        dedupeKey: params.dedupeKey,
        groupId: params.groupId,
        recipientUid: params.recipientUid,
        type: params.type,
        status: 'skipped_preference',
        attempts: 0,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    return 'skipped_preference';
  }

  const localized = buildLocalizedNotification({
    type: params.type,
    languageCode: userProfile?.preferredLanguage,
    preferredScript: userProfile?.preferredScript,
    timezone: params.timezone,
    medicationName: params.medicationName,
    scheduledTime: params.scheduledTime,
    elderlyName: params.elderlyName,
    doctorName: params.doctorName,
    clinicName: params.clinicName,
    appointmentDate: params.appointmentDate,
    appointmentTime: params.appointmentTime,
  });

  if (params.dryRun) {
    return 'delivered';
  }

  let emailMode: 'smtp' | 'test' = 'test';
  let emailSent = false;
  let attempts = 1;
  let emailReason: string | undefined;

  if (prefs.emailEnabled && privateSnap.exists) {
    const email = (privateSnap.data() as { email?: string }).email;
    if (email) {
      const retryRes = await withExponentialRetry(() =>
        sendCareNotificationEmail({
          to: email,
          notificationType: params.type,
        }),
      );
      attempts = retryRes.attempts;
      if (retryRes.result) {
        emailMode = retryRes.result.mode;
        emailSent = retryRes.result.sent;
        emailReason = retryRes.result.reason;
      } else {
        emailReason = retryRes.error;
      }
    }
  }

  const status: 'sent' | 'failed' | 'test_mode' =
    prefs.emailEnabled && !emailSent && emailMode === 'smtp'
      ? 'failed'
      : prefs.emailEnabled && emailMode === 'test' && !prefs.inAppEnabled
        ? 'test_mode'
        : 'sent';

  const batch = db.batch();

  if (prefs.inAppEnabled) {
    const notifId = generateDocId('ntf');
    batch.set(db.doc(`notifications/${notifId}`), {
      id: notifId,
      groupId: params.groupId,
      recipientUid: params.recipientUid,
      type: params.type,
      title: localized.title,
      message: localized.message,
      channel: 'in_app',
      deliveryStatus: 'sent',
      dedupeKey: params.dedupeKey,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  batch.set(deliveryRef, {
    id: deliveryDocId,
    dedupeKey: params.dedupeKey,
    groupId: params.groupId,
    recipientUid: params.recipientUid,
    type: params.type,
    languageCode: localized.languageCode,
    direction: localized.direction,
    inAppDelivered: prefs.inAppEnabled,
    emailEnabled: prefs.emailEnabled,
    emailMode,
    emailSent,
    status,
    attempts,
    ...(emailReason ? { reason: emailReason.slice(0, 300) } : {}),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  await batch.commit();

  if (status === 'failed') return 'failed';
  if (prefs.emailEnabled && emailMode === 'test' && !emailSent) return 'test_mode';
  return 'delivered';
}

export async function processSchedulerSweep(
  options: { dryRun?: boolean; timezoneOverride?: string; now?: Date } = {},
  db: Firestore = adminDb,
): Promise<SweepSummary> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? false;

  const summary: SweepSummary = {
    groupsScanned: 0,
    candidatesEvaluated: 0,
    delivered: 0,
    deduplicated: 0,
    skippedByPreference: 0,
    skippedCancelled: 0,
    testModeLogged: 0,
    failed: 0,
    dryRun,
    processedAtIso: now.toISOString(),
  };

  const groupsSnap = await db.collection('careGroups').limit(100).get();

  for (const groupDoc of groupsSnap.docs) {
    const group = groupDoc.data() as CareGroupDoc;
    summary.groupsScanned++;
    const tz = options.timezoneOverride || group.timezone || 'Asia/Kolkata';
    const todayKey = formatTimezoneDateKey(now, tz);
    const nowTimeKey = formatTimezoneTimeKey(now, tz);
    const nowMinutes = timeToMinutes(nowTimeKey);

    const [membersSnap, medsSnap, logsSnap, apptsSnap] = await Promise.all([
      db.collection(`careGroups/${group.id}/members`).get(),
      db.collection('medications').where('groupId', '==', group.id).get(),
      db.collection('medicationLogs').where('groupId', '==', group.id).get(),
      db.collection('appointments').where('groupId', '==', group.id).get(),
    ]);

    const activeMembers = membersSnap.docs
      .map((d) => d.data() as CareMemberDoc)
      .filter((m) => m.status === 'active' && group.memberUids.includes(m.uid));

    if (activeMembers.length === 0) continue;

    const logsMap = new Map<string, MedicationLogDoc>();
    for (const d of logsSnap.docs) {
      const log = d.data() as MedicationLogDoc;
      if (log.scheduledDate === todayKey) {
        logsMap.set(`${log.medicationId}_${log.scheduledTime}`, log);
      }
    }

    // 1. Evaluate dose reminders for active medications
    for (const mDoc of medsSnap.docs) {
      const med = mDoc.data() as MedicationDoc;
      if (!med.active || med.startDate > todayKey || (med.endDate && med.endDate < todayKey)) {
        continue;
      }

      for (const slotTime of med.scheduleTimes) {
        const slotMin = timeToMinutes(slotTime);
        if (slotMin < 0) continue;
        const log = logsMap.get(`${med.id}_${slotTime}`);
        if (log && (log.status === 'taken' || log.status === 'skipped')) continue;

        let category: NotificationCategory | null = null;
        if (slotMin >= nowMinutes && slotMin - nowMinutes <= 30) {
          category = 'upcoming_dose';
        } else if (nowMinutes - slotMin >= 30 && nowMinutes - slotMin < 120) {
          category = 'unconfirmed_dose';
        } else if (nowMinutes - slotMin >= 120 && log?.status !== 'missed') {
          category = 'missed_dose';
        }

        if (!category) continue;

        for (const member of activeMembers) {
          summary.candidatesEvaluated++;
          const dedupeKey = `${category}_${group.id}_${med.id}_${todayKey}_${slotTime.replace(':', '')}_${member.uid}`;
          const outcome = await deliverPersistentAlert(
            {
              groupId: group.id,
              recipientUid: member.uid,
              type: category,
              dedupeKey,
              elderlyName: group.elderlyName,
              timezone: tz,
              medicationName: med.name,
              scheduledTime: slotTime,
              dryRun,
            },
            db,
          );
          if (outcome === 'delivered') summary.delivered++;
          else if (outcome === 'deduplicated') summary.deduplicated++;
          else if (outcome === 'skipped_preference') summary.skippedByPreference++;
          else if (outcome === 'test_mode') summary.testModeLogged++;
          else if (outcome === 'failed') summary.failed++;
        }
      }
    }

    // 2. Evaluate upcoming appointments (strictly skip cancelled/completed appointments)
    for (const aDoc of apptsSnap.docs) {
      const appt = aDoc.data() as AppointmentDoc;
      if (appt.status !== 'scheduled') {
        summary.skippedCancelled++;
        continue;
      }

      const apptDateKey = formatTimezoneDateKey(now, appt.timezone || tz);
      const apptNowTimeKey = formatTimezoneTimeKey(now, appt.timezone || tz);
      if (appt.appointmentDate !== apptDateKey) continue;

      const apptMinutes = timeToMinutes(appt.appointmentTime);
      const localNowMinutes = timeToMinutes(apptNowTimeKey);
      const diff = apptMinutes - localNowMinutes;
      const lead = appt.reminderMinutesBefore ?? 120;
      if (diff < 0 || diff > lead) continue;

      for (const member of activeMembers) {
        summary.candidatesEvaluated++;
        const dedupeKey = `upcoming_appointment_${group.id}_${appt.id}_${appt.appointmentDate}_${member.uid}`;
        const outcome = await deliverPersistentAlert(
          {
            groupId: group.id,
            recipientUid: member.uid,
            type: 'upcoming_appointment',
            dedupeKey,
            elderlyName: group.elderlyName,
            timezone: appt.timezone || tz,
            doctorName: appt.doctorName,
            clinicName: appt.clinicName,
            appointmentDate: appt.appointmentDate,
            appointmentTime: appt.appointmentTime,
            dryRun,
          },
          db,
        );
        if (outcome === 'delivered') summary.delivered++;
        else if (outcome === 'deduplicated') summary.deduplicated++;
        else if (outcome === 'skipped_preference') summary.skippedByPreference++;
        else if (outcome === 'test_mode') summary.testModeLogged++;
        else if (outcome === 'failed') summary.failed++;
      }

      if (!dryRun) {
        const jobRef = db.doc(`notificationJobs/${sanitizeId(`job_apt_${appt.id}`)}`);
        const jobSnap = await jobRef.get();
        if (jobSnap.exists) {
          await jobRef.update({
            status: 'completed',
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      }
    }
  }

  return summary;
}
