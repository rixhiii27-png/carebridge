import { describe, expect, it } from 'vitest';
import {
  assertActiveMember,
  assertCanEditAppointments,
  assertCanEditMedications,
  assertGroupOwner,
} from '../../server/middleware/authorization.ts';
import { AppError } from '../../server/middleware/errorHandler.ts';
import {
  cancelAppointmentAdmin,
  createAppointmentAdmin,
} from '../../server/modules/appointments/appointmentsService.ts';
import {
  createCareGroupAdmin,
  createInvitationAdmin,
  redeemInvitationAdmin,
  revokeMemberAdmin,
} from '../../server/modules/careGroups/careGroupsService.ts';
import { buildLocalizedNotification } from '../../server/modules/localization/notificationLocalizer.ts';
import {
  computeAdherenceSummary,
  createMedication,
  normalizeDoseStatus,
  recordDoseEvent,
} from '../../server/modules/medications/medicationsService.ts';
import { processSchedulerSweep } from '../../server/modules/notifications/notificationsModule.ts';
import { deleteMyAccount, updateMyProfile } from '../../server/modules/users/usersService.ts';
import { formatTimezoneDateKey, formatTimezoneTimeKey, hashToken } from '../../server/utils/idAndDate.ts';
import { InMemoryFirestore } from '../helpers/inMemoryFirestore.ts';

describe('Server-Side RBAC & CareBridge Domain Modules', () => {
  it('enforces active care group membership, granular permissions, and revocation isolation', async () => {
    const memDb = new InMemoryFirestore();
    const db = memDb.asFirestore();

    const group = await createCareGroupAdmin(
      {
        ownerUid: 'elder_1',
        ownerName: 'Raghavan Iyer',
        ownerRole: 'elderly',
        elderlyName: 'Raghavan Iyer',
        elderlyAge: 76,
        timezone: 'Asia/Kolkata',
      },
      db,
    );

    const invite = await createInvitationAdmin(
      {
        groupId: group.id,
        actorUid: 'elder_1',
        actorName: 'Raghavan Iyer',
        actorRole: 'elderly',
        targetRole: 'caregiver',
        canEditMedications: false,
        canEditAppointments: true,
        invitedEmail: 'nurse@example.com',
      },
      db,
    );

    // Ensure plaintext token is NOT stored in Firestore; only its SHA-256 hash is persisted
    const storedInvite = memDb.store.get(`invitations/${invite.invitationId}`)!;
    expect(storedInvite.tokenHash).toBe(hashToken(invite.token));
    expect(Object.values(storedInvite)).not.toContain(invite.token);

    // Mismatched invitedEmail cannot redeem
    await expect(
      redeemInvitationAdmin(
        {
          tokenOrCode: invite.token,
          uid: 'intruder_1',
          email: 'other@example.com',
          displayName: 'Intruder',
        },
        db,
      ),
    ).rejects.toThrow(/different verified email/i);

    // Legitimate email redeems once
    await redeemInvitationAdmin(
      {
        tokenOrCode: invite.token,
        uid: 'nurse_1',
        email: 'nurse@example.com',
        displayName: 'Nurse Priya',
        relationship: 'Home Nurse',
      },
      db,
    );

    // Single-use: second redemption fails
    await expect(
      redeemInvitationAdmin(
        {
          tokenOrCode: invite.token,
          uid: 'nurse_2',
          email: 'nurse@example.com',
          displayName: 'Nurse Two',
        },
        db,
      ),
    ).rejects.toThrow(/already been redeemed/i);

    // Granular permissions enforced
    await expect(assertCanEditAppointments(group.id, 'nurse_1', db)).resolves.toBeTruthy();
    await expect(assertCanEditMedications(group.id, 'nurse_1', db)).rejects.toBeInstanceOf(AppError);
    await expect(assertGroupOwner(group.id, 'nurse_1', db)).rejects.toBeInstanceOf(AppError);

    // Revoking member immediately removes access
    await revokeMemberAdmin(
      { groupId: group.id, targetUid: 'nurse_1', actorUid: 'elder_1', actorName: 'Raghavan Iyer' },
      db,
    );
    await expect(assertActiveMember(group.id, 'nurse_1', db)).rejects.toBeInstanceOf(AppError);

    // Owner cannot be revoked
    await expect(
      revokeMemberAdmin(
        { groupId: group.id, targetUid: 'elder_1', actorUid: 'elder_1', actorName: 'Raghavan Iyer' },
        db,
      ),
    ).rejects.toThrow(/owner permissions/i);
  });

  it('normalizes unconfirmed doses separately from taken and triggers alerts on missed doses', async () => {
    const memDb = new InMemoryFirestore();
    const db = memDb.asFirestore();

    expect(normalizeDoseStatus('unconfirmed')).toBe('not_confirmed');
    expect(normalizeDoseStatus('taken')).toBe('taken');

    const group = await createCareGroupAdmin(
      {
        ownerUid: 'elder_1',
        ownerName: 'Raghavan',
        ownerRole: 'elderly',
        elderlyName: 'Raghavan',
        elderlyAge: 75,
        timezone: 'Asia/Kolkata',
      },
      db,
    );

    const invite = await createInvitationAdmin(
      {
        groupId: group.id,
        actorUid: 'elder_1',
        actorName: 'Raghavan',
        actorRole: 'elderly',
        targetRole: 'family',
        canEditMedications: true,
        canEditAppointments: true,
      },
      db,
    );
    await redeemInvitationAdmin(
      { tokenOrCode: invite.token, uid: 'family_1', displayName: 'Meera' },
      db,
    );

    const today = formatTimezoneDateKey(new Date(), 'Asia/Kolkata');
    const med = await createMedication(
      'elder_1',
      'Raghavan',
      {
        groupId: group.id,
        name: 'Metformin',
        dosage: '500 mg',
        scheduleTimes: ['08:00', '20:00'],
        frequency: 'twice_daily',
        startDate: today,
      },
      db,
    );

    await recordDoseEvent(
      {
        medId: med.id,
        actorUid: 'elder_1',
        actorName: 'Raghavan',
        scheduledDate: today,
        scheduledTime: '08:00',
        status: 'missed',
      },
      db,
    );

    // Adherence summary never treats unconfirmed 20:00 slot as taken
    const adherence = computeAdherenceSummary(
      [med],
      [
        {
          id: 'l1',
          groupId: group.id,
          memberUids: ['elder_1', 'family_1'],
          medicationId: med.id,
          medicationName: med.name,
          scheduledDate: today,
          scheduledTime: '08:00',
          status: 'missed',
          updatedByUid: 'elder_1',
          updatedByName: 'Raghavan',
        },
      ],
      today,
      1,
    );
    expect(adherence.missed).toBe(1);
    expect(adherence.notConfirmed).toBe(1);
    expect(adherence.taken).toBe(0);
    expect(adherence.adherencePercent).toBe(0);

    // Missed dose generated notification for active family_1 peer
    const notifs = await db.collection('notifications').where('recipientUid', '==', 'family_1').get();
    expect(notifs.docs.length).toBe(1);
    expect((notifs.docs[0].data() as { type: string }).type).toBe('missed_dose');
  });

  it('cancels notification jobs when an appointment is cancelled and prevents past-date appointments', async () => {
    const memDb = new InMemoryFirestore();
    const db = memDb.asFirestore();

    const group = await createCareGroupAdmin(
      {
        ownerUid: 'elder_2',
        ownerName: 'Lakshmi',
        ownerRole: 'elderly',
        elderlyName: 'Lakshmi',
        elderlyAge: 78,
        timezone: 'Asia/Kolkata',
      },
      db,
    );

    // Reject past date
    await expect(
      createAppointmentAdmin(
        'elder_2',
        'Lakshmi',
        {
          groupId: group.id,
          doctorName: 'Dr. Nair',
          clinicName: 'City Clinic',
          appointmentDate: '2020-01-15',
          appointmentTime: '10:00',
          timezone: 'Asia/Kolkata',
          reminderMinutesBefore: 60,
        },
        db,
      ),
    ).rejects.toThrow(/cannot be in the past/i);

    const futureDate = '2099-12-20';
    const appt = await createAppointmentAdmin(
      'elder_2',
      'Lakshmi',
      {
        groupId: group.id,
        doctorName: 'Dr. Nair',
        clinicName: 'City Clinic',
        appointmentDate: futureDate,
        appointmentTime: '10:30',
        timezone: 'Asia/Kolkata',
        reminderMinutesBefore: 120,
      },
      db,
    );

    expect(memDb.store.get(`notificationJobs/job_apt_${appt.id}`)?.status).toBe('pending');

    await cancelAppointmentAdmin(appt.id, 'elder_2', 'Lakshmi', db);
    expect(memDb.store.get(`appointments/${appt.id}`)?.status).toBe('cancelled');
    expect(memDb.store.get(`notificationJobs/job_apt_${appt.id}`)?.status).toBe('cancelled');
  });

  it('runs persistent scheduler sweep without duplicates, skips revoked members, and localizes alerts cleanly', async () => {
    const memDb = new InMemoryFirestore();
    const db = memDb.asFirestore();

    // Hindi and Urdu localized alert formatting preserving brand name 'Amlodipine'
    const hiAlert = buildLocalizedNotification({
      type: 'upcoming_dose',
      languageCode: 'hi',
      medicationName: 'Amlodipine',
      scheduledTime: '09:00',
      elderlyName: 'Raghavan',
    });
    expect(hiAlert.title).toContain('Amlodipine');
    expect(hiAlert.direction).toBe('ltr');

    const urAlert = buildLocalizedNotification({
      type: 'upcoming_dose',
      languageCode: 'ur',
      medicationName: 'Amlodipine',
      scheduledTime: '09:00',
      elderlyName: 'Raghavan',
    });
    expect(urAlert.title).toContain('Amlodipine');
    expect(urAlert.direction).toBe('rtl');

    await db.doc('users/elder_3').set({
      uid: 'elder_3',
      displayName: 'Raghavan',
      role: 'elderly',
      preferredLanguage: 'hi',
      timezone: 'Asia/Kolkata',
    });

    const group = await createCareGroupAdmin(
      {
        ownerUid: 'elder_3',
        ownerName: 'Raghavan',
        ownerRole: 'elderly',
        elderlyName: 'Raghavan',
        elderlyAge: 74,
        timezone: 'Asia/Kolkata',
      },
      db,
    );

    const invite = await createInvitationAdmin(
      {
        groupId: group.id,
        actorUid: 'elder_3',
        actorName: 'Raghavan',
        actorRole: 'elderly',
        targetRole: 'caregiver',
        canEditMedications: false,
        canEditAppointments: false,
      },
      db,
    );
    await redeemInvitationAdmin({ tokenOrCode: invite.token, uid: 'cg_revoked', displayName: 'Revoked CG' }, db);
    await revokeMemberAdmin(
      { groupId: group.id, targetUid: 'cg_revoked', actorUid: 'elder_3', actorName: 'Raghavan' },
      db,
    );

    // Schedule dose 15 mins from now so upcoming_dose triggers
    const now = new Date();
    const plus15 = new Date(now.getTime() + 15 * 60 * 1000);
    const today = formatTimezoneDateKey(plus15, 'Asia/Kolkata');
    const slotTime = formatTimezoneTimeKey(plus15, 'Asia/Kolkata');

    await createMedication(
      'elder_3',
      'Raghavan',
      {
        groupId: group.id,
        name: 'Amlodipine',
        dosage: '5 mg',
        scheduleTimes: [slotTime],
        frequency: 'once_daily',
        startDate: formatTimezoneDateKey(new Date(now.getTime() - 86400_000), 'Asia/Kolkata'),
      },
      db,
    );

    const sweep1 = await processSchedulerSweep({ dryRun: false, now }, db);
    expect(sweep1.delivered).toBe(1);
    expect(sweep1.deduplicated).toBe(0);

    // Revoked caregiver must NOT receive any notification
    const cgNotifs = await db.collection('notifications').where('recipientUid', '==', 'cg_revoked').get();
    expect(cgNotifs.docs.length).toBe(0);

    // Repeated sweep deduplicates against Firestore notificationDeliveryLogs
    const sweep2 = await processSchedulerSweep({ dryRun: false, now }, db);
    expect(sweep2.delivered).toBe(0);
    expect(sweep2.deduplicated).toBe(1);

    // Verify today string formatting consistency
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('prevents unauthorized activeGroupId switch and cleanly cleans up PII on deleteMyAccount', async () => {
    const memDb = new InMemoryFirestore();
    const db = memDb.asFirestore();

    await db.doc('users/user_del').set({
      uid: 'user_del',
      displayName: 'Test User',
      role: 'family',
      preferredLanguage: 'en',
      timezone: 'Asia/Kolkata',
    });
    await db.doc('users/user_del/private/info').set({
      uid: 'user_del',
      email: 'test@example.com',
    });

    await expect(
      updateMyProfile('user_del', 'test@example.com', { activeGroupId: 'grp_missing' }, db),
    ).rejects.toThrow();

    const revokedTokensFor: string[] = [];
    const fakeAuth = {
      revokeRefreshTokens: async (uid: string) => {
        revokedTokensFor.push(uid);
      },
    } as unknown as import('firebase-admin/auth').Auth;

    const delRes = await deleteMyAccount('user_del', db, fakeAuth);
    expect(delRes.deleted).toBe(true);
    expect(revokedTokensFor).toEqual(['user_del']);
    expect(memDb.store.has('users/user_del/private/info')).toBe(false);
    expect(memDb.store.has('users/user_del')).toBe(false);
  });
});
