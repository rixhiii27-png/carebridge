import type { Firestore } from 'firebase-admin/firestore';
import { adminDb } from '../../config/firebase.ts';
import { assertActiveMember } from '../../middleware/authorization.ts';
import { clampPagination, formatTimezoneDateKey } from '../../utils/idAndDate.ts';
import type { AppointmentDoc } from '../appointments/appointmentsService.ts';
import {
  computeAdherenceSummary,
  deriveScheduledDoseSlots,
  type MedicationDoc,
  type MedicationLogDoc,
} from '../medications/medicationsService.ts';

export async function getDashboardOverview(
  groupId: string,
  actorUid: string,
  db: Firestore = adminDb,
): Promise<{
  group: {
    id: string;
    elderlyName: string;
    elderlyAge: number;
    timezone: string;
    activeMemberCount: number;
  };
  todayDateKey: string;
  activeMedicationsCount: number;
  todayDoses: {
    total: number;
    taken: number;
    skipped: number;
    missed: number;
    notConfirmed: number;
    slots: ReturnType<typeof deriveScheduledDoseSlots>;
  };
  upcomingAppointments: AppointmentDoc[];
  unreadNotificationsCount: number;
  recentActivity: Array<Record<string, unknown>>;
}> {
  const { group } = await assertActiveMember(groupId, actorUid, db);
  const tz = group.timezone || 'Asia/Kolkata';
  const todayDateKey = formatTimezoneDateKey(new Date(), tz);

  const [medsSnap, logsSnap, apptsSnap, notifsSnap, actSnap] = await Promise.all([
    db.collection('medications').where('groupId', '==', groupId).get(),
    db.collection('medicationLogs').where('groupId', '==', groupId).get(),
    db.collection('appointments').where('groupId', '==', groupId).get(),
    db.collection('notifications').where('recipientUid', '==', actorUid).get(),
    db.collection('activityLogs').where('groupId', '==', groupId).get(),
  ]);

  const meds = medsSnap.docs.map((d) => d.data() as MedicationDoc);
  const logs = logsSnap.docs.map((d) => d.data() as MedicationLogDoc);
  const slots = deriveScheduledDoseSlots(meds, logs, todayDateKey);

  const upcomingAppointments = apptsSnap.docs
    .map((d) => d.data() as AppointmentDoc)
    .filter((a) => a.status === 'scheduled' && a.appointmentDate >= todayDateKey)
    .sort((a, b) =>
      `${a.appointmentDate} ${a.appointmentTime}`.localeCompare(
        `${b.appointmentDate} ${b.appointmentTime}`,
      ),
    )
    .slice(0, 10);

  const unreadNotificationsCount = notifsSnap.docs
    .map((d) => d.data() as { read?: boolean; groupId?: string })
    .filter((n) => n.read === false && n.groupId === groupId).length;

  const recentActivity = actSnap.docs
    .map((d) => d.data() as Record<string, unknown>)
    .sort((a, b) => {
      const ta = (a.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
      const tb = (b.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
      return tb - ta;
    })
    .slice(0, 10);

  return {
    group: {
      id: group.id,
      elderlyName: group.elderlyName,
      elderlyAge: group.elderlyAge,
      timezone: tz,
      activeMemberCount: group.memberUids.length,
    },
    todayDateKey,
    activeMedicationsCount: meds.filter((m) => m.active).length,
    todayDoses: {
      total: slots.length,
      taken: slots.filter((s) => s.status === 'taken').length,
      skipped: slots.filter((s) => s.status === 'skipped').length,
      missed: slots.filter((s) => s.status === 'missed').length,
      notConfirmed: slots.filter((s) => s.status === 'not_confirmed').length,
      slots,
    },
    upcomingAppointments,
    unreadNotificationsCount,
    recentActivity,
  };
}

export async function getAdherenceAnalytics(
  groupId: string,
  actorUid: string,
  period: 'daily' | 'weekly' | 'monthly' = 'weekly',
  db: Firestore = adminDb,
): Promise<{
  groupId: string;
  period: 'daily' | 'weekly' | 'monthly';
  timezone: string;
  todayDateKey: string;
  summary: ReturnType<typeof computeAdherenceSummary>;
}> {
  const { group } = await assertActiveMember(groupId, actorUid, db);
  const tz = group.timezone || 'Asia/Kolkata';
  const todayDateKey = formatTimezoneDateKey(new Date(), tz);
  const daysCount = period === 'daily' ? 1 : period === 'monthly' ? 30 : 7;

  const [medsSnap, logsSnap] = await Promise.all([
    db.collection('medications').where('groupId', '==', groupId).get(),
    db.collection('medicationLogs').where('groupId', '==', groupId).get(),
  ]);

  const meds = medsSnap.docs.map((d) => d.data() as MedicationDoc);
  const logs = logsSnap.docs.map((d) => d.data() as MedicationLogDoc);

  return {
    groupId,
    period,
    timezone: tz,
    todayDateKey,
    summary: computeAdherenceSummary(meds, logs, todayDateKey, daysCount),
  };
}

export async function getActivityFeed(
  groupId: string,
  actorUid: string,
  options: { limit?: number; offset?: number } = {},
  db: Firestore = adminDb,
): Promise<{ items: Array<Record<string, unknown>>; total: number; limit: number; offset: number }> {
  await assertActiveMember(groupId, actorUid, db);
  const { limit, offset } = clampPagination(options.limit, options.offset);

  const snap = await db.collection('activityLogs').where('groupId', '==', groupId).get();
  const items = snap.docs
    .map((d) => d.data() as Record<string, unknown>)
    .sort((a, b) => {
      const ta = (a.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
      const tb = (b.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
      return tb - ta;
    });

  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    limit,
    offset,
  };
}
