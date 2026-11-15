import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import type {
  ActivityLog,
  Appointment,
  AppointmentStatus,
  CareGroup,
  CareMember,
  CareMembership,
  DoseStatus,
  Invitation,
  Medication,
  MedicationFrequency,
  MedicationLog,
  NotificationPreference,
  NotificationRecord,
  UserPrivateInfo,
  UserProfile,
  UserRole,
} from '../types/carebridge.ts';
import { auth, db, getTodayDateKey, handleFirestoreError, logFirestoreError, OperationType } from './firebase.ts';

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
}

function clampStr(val: string | undefined, maxLen: number): string | undefined {
  if (val === undefined) return undefined;
  return val.trim().slice(0, maxLen);
}

function generateId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return sanitizeId(`${prefix}_${ts}_${rand}`);
}

export function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let part1 = '';
  let part2 = '';
  for (let i = 0; i < 4; i++) {
    part1 += chars[Math.floor(Math.random() * chars.length)];
    part2 += chars[Math.floor(Math.random() * chars.length)];
  }
  return `CB-${part1}-${part2}`;
}

export async function upsertUserProfile(params: {
  uid: string;
  displayName: string;
  email: string;
  role: UserRole;
  preferredLanguage: string;
  preferredScript?: string;
  timezone: string;
}): Promise<void> {
  const userRef = doc(db, 'users', params.uid);
  const privateRef = doc(db, 'users', params.uid, 'private', 'info');
  const prefRef = doc(db, 'notificationPreferences', params.uid);

  try {
    const existingSnap = await getDoc(userRef);
    const batch = writeBatch(db);

    if (!existingSnap.exists()) {
      batch.set(userRef, {
        uid: params.uid,
        displayName: clampStr(params.displayName, 120) || 'CareBridge User',
        role: params.role,
        preferredLanguage: clampStr(params.preferredLanguage, 16) || 'en',
        preferredScript: clampStr(params.preferredScript, 32) || 'Latin',
        timezone: clampStr(params.timezone, 64) || 'Asia/Kolkata',
        largeText: false,
        highContrast: false,
        largeButtons: false,
        simpleNavigation: false,
        reducedMotion: false,
        voiceEnabled: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.update(userRef, {
        displayName: clampStr(params.displayName, 120) || 'CareBridge User',
        role: params.role,
        preferredLanguage: clampStr(params.preferredLanguage, 16) || 'en',
        preferredScript: clampStr(params.preferredScript, 32) || 'Latin',
        timezone: clampStr(params.timezone, 64) || 'Asia/Kolkata',
        updatedAt: serverTimestamp(),
      });
    }

    batch.set(
      privateRef,
      {
        uid: params.uid,
        email: clampStr(params.email, 254) || 'user@carebridge.local',
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    const prefSnap = await getDoc(prefRef);
    if (!prefSnap.exists()) {
      batch.set(prefRef, {
        uid: params.uid,
        inAppEnabled: true,
        emailEnabled: false,
        upcomingDoseAlert: true,
        unconfirmedDoseAlert: true,
        missedDoseAlert: true,
        appointmentAlert: true,
        caregiverUpdateAlert: true,
        timezone: clampStr(params.timezone, 64) || 'Asia/Kolkata',
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${params.uid}`);
  }
}

export async function updateUserPreferences(
  uid: string,
  patch: Partial<UserProfile>,
): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      ...patch,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function getUserPrivateInfo(uid: string): Promise<UserPrivateInfo | null> {
  const path = `users/${uid}/private/info`;
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'private', 'info'));
    return snap.exists() ? (snap.data() as UserPrivateInfo) : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function updateUserPrivateInfo(
  uid: string,
  patch: Pick<UserPrivateInfo, 'email' | 'phone' | 'emergencyContact' | 'address'>,
): Promise<void> {
  const path = `users/${uid}/private/info`;
  try {
    const clean: Record<string, unknown> = {
      uid,
      email: clampStr(patch.email, 254) || '',
      updatedAt: serverTimestamp(),
    };
    if (patch.phone !== undefined) clean.phone = clampStr(patch.phone, 32);
    if (patch.emergencyContact !== undefined) {
      clean.emergencyContact = clampStr(patch.emergencyContact, 160);
    }
    if (patch.address !== undefined) clean.address = clampStr(patch.address, 250);
    await setDoc(doc(db, 'users', uid, 'private', 'info'), clean);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function createCareGroup(params: {
  ownerUid: string;
  ownerName: string;
  ownerRole: UserRole;
  elderlyName: string;
  elderlyAge: number;
  bloodGroup?: string;
  primaryPhysician?: string;
  primaryClinic?: string;
  timezone: string;
  allergies?: string[];
  conditions?: string[];
}): Promise<string> {
  const groupId = generateId('grp');
  const membershipId = sanitizeId(`${groupId}_${params.ownerUid}`);
  const logId = generateId('act');

  try {
    const batch = writeBatch(db);

    batch.set(doc(db, 'careGroups', groupId), {
      id: groupId,
      ownerId: params.ownerUid,
      elderlyName: clampStr(params.elderlyName, 120) || 'Resident',
      elderlyAge: Math.max(1, Math.min(130, Math.round(params.elderlyAge))),
      bloodGroup: clampStr(params.bloodGroup, 16) || '',
      primaryPhysician: clampStr(params.primaryPhysician, 120) || '',
      primaryClinic: clampStr(params.primaryClinic, 160) || '',
      timezone: clampStr(params.timezone, 64) || 'Asia/Kolkata',
      allergies: (params.allergies ?? []).slice(0, 20),
      conditions: (params.conditions ?? []).slice(0, 20),
      memberUids: [params.ownerUid],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'careGroups', groupId, 'members', params.ownerUid), {
      uid: params.ownerUid,
      groupId,
      displayName: clampStr(params.ownerName, 120) || 'Owner',
      role: params.ownerRole,
      relationship: params.ownerRole === 'elderly' ? 'Self' : 'Care Coordinator',
      canEditMedications: true,
      canEditAppointments: true,
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'careMemberships', membershipId), {
      uid: params.ownerUid,
      groupId,
      elderlyName: clampStr(params.elderlyName, 120) || 'Resident',
      role: params.ownerRole,
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'activityLogs', logId), {
      id: logId,
      groupId,
      memberUids: [params.ownerUid],
      actorUid: params.ownerUid,
      actorName: clampStr(params.ownerName, 120) || 'User',
      actorRole: params.ownerRole,
      actionType: 'CARE_GROUP_CREATED',
      entityType: 'careGroup',
      entityId: groupId,
      summary: `Created care profile for ${clampStr(params.elderlyName, 80)}`,
      createdAt: serverTimestamp(),
    });

    batch.update(doc(db, 'users', params.ownerUid), {
      activeGroupId: groupId,
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
    return groupId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `careGroups/${groupId}`);
  }
}

export async function updateCareGroupProfile(
  groupId: string,
  patch: Partial<CareGroup>,
  actor: { uid: string; name: string; role: UserRole },
  memberUids: string[],
): Promise<void> {
  const path = `careGroups/${groupId}`;
  try {
    const batch = writeBatch(db);
    const clean: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (patch.elderlyName !== undefined) clean.elderlyName = clampStr(patch.elderlyName, 120);
    if (patch.elderlyAge !== undefined) clean.elderlyAge = Math.max(1, Math.min(130, Math.round(patch.elderlyAge)));
    if (patch.bloodGroup !== undefined) clean.bloodGroup = clampStr(patch.bloodGroup, 16);
    if (patch.primaryPhysician !== undefined) clean.primaryPhysician = clampStr(patch.primaryPhysician, 120);
    if (patch.primaryClinic !== undefined) clean.primaryClinic = clampStr(patch.primaryClinic, 160);
    if (patch.timezone !== undefined) clean.timezone = clampStr(patch.timezone, 64);
    if (patch.allergies !== undefined) clean.allergies = patch.allergies.slice(0, 20);
    if (patch.conditions !== undefined) clean.conditions = patch.conditions.slice(0, 20);

    batch.update(doc(db, 'careGroups', groupId), clean);

    const logId = generateId('act');
    batch.set(doc(db, 'activityLogs', logId), {
      id: logId,
      groupId,
      memberUids,
      actorUid: actor.uid,
      actorName: clampStr(actor.name, 120) || 'User',
      actorRole: actor.role,
      actionType: 'CARE_PROFILE_UPDATED',
      entityType: 'careGroup',
      entityId: groupId,
      summary: 'Updated resident care profile details',
      createdAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function fetchCareMembers(groupId: string, memberUids: string[]): Promise<CareMember[]> {
  try {
    const results = await Promise.all(
      memberUids.slice(0, 20).map(async (uid) => {
        const snap = await getDoc(doc(db, 'careGroups', groupId, 'members', uid));
        return snap.exists() ? (snap.data() as CareMember) : null;
      }),
    );
    return results.filter((m): m is CareMember => m !== null);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `careGroups/${groupId}/members`);
  }
}

export async function createInvitationCode(params: {
  groupId: string;
  elderlyName: string;
  createdBy: string;
  targetRole: 'family' | 'caregiver';
  canEditMedications: boolean;
  canEditAppointments: boolean;
}): Promise<Invitation> {
  const code = generateInviteCode();
  const expiresAtMs = Date.now() + 24 * 60 * 60 * 1000;
  const path = `invitations/${code}`;
  try {
    const payload = {
      code,
      groupId: params.groupId,
      elderlyName: clampStr(params.elderlyName, 120) || 'Resident',
      createdBy: params.createdBy,
      targetRole: params.targetRole,
      canEditMedications: params.canEditMedications,
      canEditAppointments: params.canEditAppointments,
      status: 'pending' as const,
      expiresAtMs,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(doc(db, 'invitations', code), payload);
    return payload;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function revokeInvitation(code: string): Promise<void> {
  const path = `invitations/${code}`;
  try {
    await updateDoc(doc(db, 'invitations', code), {
      status: 'revoked',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function redeemInvitationCode(params: {
  code: string;
  uid: string;
  displayName: string;
  relationship?: string;
}): Promise<string> {
  const cleanCode = params.code.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const inviteRef = doc(db, 'invitations', cleanCode);

  try {
    const inviteSnap = await getDoc(inviteRef);
    if (!inviteSnap.exists()) {
      throw new Error('Invitation code not found.');
    }
    const invite = inviteSnap.data() as Invitation;
    if (invite.status !== 'pending') {
      throw new Error('This invitation code has already been used or revoked.');
    }
    if (invite.expiresAtMs <= Date.now()) {
      throw new Error('This invitation code has expired.');
    }

    const groupRef = doc(db, 'careGroups', invite.groupId);
    const groupSnap = await getDoc(groupRef);
    if (!groupSnap.exists()) {
      throw new Error('Care group no longer exists.');
    }
    const group = groupSnap.data() as CareGroup;
    const updatedMemberUids = Array.from(new Set([...group.memberUids, params.uid])).slice(0, 20);
    const membershipId = sanitizeId(`${invite.groupId}_${params.uid}`);
    const logId = generateId('act');

    const batch = writeBatch(db);

    batch.update(inviteRef, {
      status: 'redeemed',
      redeemedBy: params.uid,
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'careGroups', invite.groupId, 'members', params.uid), {
      uid: params.uid,
      groupId: invite.groupId,
      displayName: clampStr(params.displayName, 120) || 'Care Member',
      role: invite.targetRole,
      relationship: clampStr(params.relationship, 64) || invite.targetRole,
      inviteCode: cleanCode,
      canEditMedications: invite.canEditMedications,
      canEditAppointments: invite.canEditAppointments,
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'careMemberships', membershipId), {
      uid: params.uid,
      groupId: invite.groupId,
      elderlyName: invite.elderlyName,
      role: invite.targetRole,
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.update(groupRef, {
      memberUids: updatedMemberUids,
      updatedAt: serverTimestamp(),
    });

    batch.update(doc(db, 'users', params.uid), {
      activeGroupId: invite.groupId,
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'activityLogs', logId), {
      id: logId,
      groupId: invite.groupId,
      memberUids: updatedMemberUids,
      actorUid: params.uid,
      actorName: clampStr(params.displayName, 120) || 'Member',
      actorRole: invite.targetRole,
      actionType: 'MEMBER_JOINED',
      entityType: 'member',
      entityId: params.uid,
      summary: `${clampStr(params.displayName, 60)} joined as ${invite.targetRole}`,
      createdAt: serverTimestamp(),
    });

    await batch.commit();
    return invite.groupId;
  } catch (error) {
    if (error instanceof Error && (error.message.includes('Invitation') || error.message.includes('Care group'))) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, `invitations/${cleanCode}`);
  }
}

export async function updateMemberPermissionsOrRevoke(params: {
  groupId: string;
  targetUid: string;
  targetName: string;
  canEditMedications: boolean;
  canEditAppointments: boolean;
  status: 'active' | 'revoked';
  actor: { uid: string; name: string; role: UserRole };
  currentMemberUids: string[];
}): Promise<void> {
  const path = `careGroups/${params.groupId}/members/${params.targetUid}`;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'careGroups', params.groupId, 'members', params.targetUid), {
      canEditMedications: params.canEditMedications,
      canEditAppointments: params.canEditAppointments,
      status: params.status,
      updatedAt: serverTimestamp(),
    });

    const membershipId = sanitizeId(`${params.groupId}_${params.targetUid}`);
    batch.update(doc(db, 'careMemberships', membershipId), {
      status: params.status,
      updatedAt: serverTimestamp(),
    });

    const nextUids =
      params.status === 'revoked'
        ? params.currentMemberUids.filter((id) => id !== params.targetUid)
        : params.currentMemberUids;

    if (params.status === 'revoked' && nextUids.length > 0) {
      batch.update(doc(db, 'careGroups', params.groupId), {
        memberUids: nextUids,
        updatedAt: serverTimestamp(),
      });
    }

    const logId = generateId('act');
    batch.set(doc(db, 'activityLogs', logId), {
      id: logId,
      groupId: params.groupId,
      memberUids: nextUids.length > 0 ? nextUids : [params.actor.uid],
      actorUid: params.actor.uid,
      actorName: clampStr(params.actor.name, 120) || 'Owner',
      actorRole: params.actor.role,
      actionType: params.status === 'revoked' ? 'MEMBER_REVOKED' : 'MEMBER_PERMISSIONS_UPDATED',
      entityType: 'member',
      entityId: params.targetUid,
      summary:
        params.status === 'revoked'
          ? `Revoked access for ${params.targetName}`
          : `Updated permissions for ${params.targetName}`,
      createdAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function addMedication(params: {
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
  actor: { uid: string; name: string; role: UserRole };
}): Promise<string> {
  const medId = generateId('med');
  const logId = generateId('act');
  const cleanTimes = params.scheduleTimes.slice(0, 8).map((t) => t.trim().slice(0, 5));

  try {
    const batch = writeBatch(db);
    const medDoc: Record<string, unknown> = {
      id: medId,
      groupId: params.groupId,
      memberUids: params.memberUids.slice(0, 20),
      name: clampStr(params.name, 120) || 'Medication',
      dosage: clampStr(params.dosage, 80) || 'As directed',
      scheduleTimes: cleanTimes.length > 0 ? cleanTimes : ['08:00'],
      frequency: params.frequency,
      startDate: params.startDate.slice(0, 10),
      active: true,
      createdBy: params.actor.uid,
      updatedBy: params.actor.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (params.endDate) medDoc.endDate = params.endDate.slice(0, 10);
    if (params.instructions) medDoc.instructions = clampStr(params.instructions, 500);
    if (params.prescriberName) medDoc.prescriberName = clampStr(params.prescriberName, 120);
    if (params.prescriberClinic) medDoc.prescriberClinic = clampStr(params.prescriberClinic, 160);

    batch.set(doc(db, 'medications', medId), medDoc);

    batch.set(doc(db, 'activityLogs', logId), {
      id: logId,
      groupId: params.groupId,
      memberUids: params.memberUids.slice(0, 20),
      actorUid: params.actor.uid,
      actorName: clampStr(params.actor.name, 120) || 'User',
      actorRole: params.actor.role,
      actionType: 'MEDICATION_ADDED',
      entityType: 'medication',
      entityId: medId,
      summary: `Added medication ${clampStr(params.name, 80)} (${clampStr(params.dosage, 40)})`,
      createdAt: serverTimestamp(),
    });

    await batch.commit();
    return medId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `medications/${medId}`);
  }
}

export async function updateMedication(
  medId: string,
  groupId: string,
  memberUids: string[],
  patch: Partial<Medication>,
  actor: { uid: string; name: string; role: UserRole },
): Promise<void> {
  const path = `medications/${medId}`;
  try {
    const batch = writeBatch(db);
    const clean: Record<string, unknown> = {
      updatedBy: actor.uid,
      updatedAt: serverTimestamp(),
    };
    if (patch.name !== undefined) clean.name = clampStr(patch.name, 120);
    if (patch.dosage !== undefined) clean.dosage = clampStr(patch.dosage, 80);
    if (patch.scheduleTimes !== undefined) {
      clean.scheduleTimes = patch.scheduleTimes.slice(0, 8).map((t) => t.slice(0, 5));
    }
    if (patch.frequency !== undefined) clean.frequency = patch.frequency;
    if (patch.startDate !== undefined) clean.startDate = patch.startDate.slice(0, 10);
    if (patch.endDate !== undefined) clean.endDate = patch.endDate.slice(0, 10);
    if (patch.instructions !== undefined) clean.instructions = clampStr(patch.instructions, 500);
    if (patch.prescriberName !== undefined) clean.prescriberName = clampStr(patch.prescriberName, 120);
    if (patch.prescriberClinic !== undefined) clean.prescriberClinic = clampStr(patch.prescriberClinic, 160);
    if (patch.active !== undefined) clean.active = patch.active;

    batch.update(doc(db, 'medications', medId), clean);

    const logId = generateId('act');
    batch.set(doc(db, 'activityLogs', logId), {
      id: logId,
      groupId,
      memberUids: memberUids.slice(0, 20),
      actorUid: actor.uid,
      actorName: clampStr(actor.name, 120) || 'User',
      actorRole: actor.role,
      actionType: patch.active === false ? 'MEDICATION_DEACTIVATED' : 'MEDICATION_UPDATED',
      entityType: 'medication',
      entityId: medId,
      summary:
        patch.active === false
          ? `Deactivated medication ${patch.name ?? ''}`
          : `Updated medication details ${patch.name ?? ''}`,
      createdAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function recordDoseStatus(params: {
  groupId: string;
  memberUids: string[];
  medicationId: string;
  medicationName: string;
  scheduledDate: string;
  scheduledTime: string;
  status: DoseStatus;
  note?: string;
  actor: { uid: string; name: string; role: UserRole };
}): Promise<void> {
  const logId = sanitizeId(
    `dose_${params.medicationId}_${params.scheduledDate}_${params.scheduledTime.replace(':', '')}`,
  );
  const actId = generateId('act');
  const path = `medicationLogs/${logId}`;

  try {
    const existingSnap = await getDoc(doc(db, 'medicationLogs', logId));
    const batch = writeBatch(db);

    if (existingSnap.exists()) {
      const updatePayload: Record<string, unknown> = {
        status: params.status,
        updatedByUid: params.actor.uid,
        updatedByName: clampStr(params.actor.name, 120) || 'User',
        updatedAt: serverTimestamp(),
      };
      if (params.note !== undefined) updatePayload.note = clampStr(params.note, 300);
      batch.update(doc(db, 'medicationLogs', logId), updatePayload);
    } else {
      const createPayload: Record<string, unknown> = {
        id: logId,
        groupId: params.groupId,
        memberUids: params.memberUids.slice(0, 20),
        medicationId: params.medicationId,
        medicationName: clampStr(params.medicationName, 120) || 'Medication',
        scheduledDate: params.scheduledDate.slice(0, 10),
        scheduledTime: params.scheduledTime.slice(0, 5),
        status: params.status,
        updatedByUid: params.actor.uid,
        updatedByName: clampStr(params.actor.name, 120) || 'User',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (params.note) createPayload.note = clampStr(params.note, 300);
      batch.set(doc(db, 'medicationLogs', logId), createPayload);
    }

    batch.set(doc(db, 'activityLogs', actId), {
      id: actId,
      groupId: params.groupId,
      memberUids: params.memberUids.slice(0, 20),
      actorUid: params.actor.uid,
      actorName: clampStr(params.actor.name, 120) || 'User',
      actorRole: params.actor.role,
      actionType: 'DOSE_STATUS_RECORDED',
      entityType: 'medicationLog',
      entityId: logId,
      summary: `Marked ${params.medicationName} (${params.scheduledTime}) as ${params.status}`,
      createdAt: serverTimestamp(),
    });

    // Notify other care group members if missed or skipped
    if (params.status === 'missed' || params.status === 'skipped') {
      for (const uid of params.memberUids.slice(0, 10)) {
        if (uid === params.actor.uid) continue;
        const notifId = generateId('ntf');
        batch.set(doc(db, 'notifications', notifId), {
          id: notifId,
          groupId: params.groupId,
          recipientUid: uid,
          type: params.status === 'missed' ? 'missed_dose' : 'caregiver_update',
          title: `Dose ${params.status}: ${clampStr(params.medicationName, 60)}`,
          message: `${clampStr(params.actor.name, 60)} marked ${params.scheduledTime} dose as ${params.status}.`,
          channel: 'in_app',
          deliveryStatus: 'sent',
          dedupeKey: `${logId}_${params.status}_${uid}`,
          read: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function createAppointment(params: {
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
  actor: { uid: string; name: string; role: UserRole };
}): Promise<string> {
  const apptId = generateId('apt');
  const actId = generateId('act');

  try {
    const batch = writeBatch(db);
    const payload: Record<string, unknown> = {
      id: apptId,
      groupId: params.groupId,
      memberUids: params.memberUids.slice(0, 20),
      doctorName: clampStr(params.doctorName, 120) || 'Doctor',
      clinicName: clampStr(params.clinicName, 160) || 'Clinic',
      appointmentDate: params.appointmentDate.slice(0, 10),
      appointmentTime: params.appointmentTime.slice(0, 5),
      timezone: clampStr(params.timezone, 64) || 'Asia/Kolkata',
      reminderMinutesBefore: Math.max(0, Math.min(10080, Math.round(params.reminderMinutesBefore))),
      status: 'scheduled',
      createdBy: params.actor.uid,
      updatedBy: params.actor.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (params.specialty) payload.specialty = clampStr(params.specialty, 80);
    if (params.notes) payload.notes = clampStr(params.notes, 500);

    batch.set(doc(db, 'appointments', apptId), payload);

    batch.set(doc(db, 'activityLogs', actId), {
      id: actId,
      groupId: params.groupId,
      memberUids: params.memberUids.slice(0, 20),
      actorUid: params.actor.uid,
      actorName: clampStr(params.actor.name, 120) || 'User',
      actorRole: params.actor.role,
      actionType: 'APPOINTMENT_SCHEDULED',
      entityType: 'appointment',
      entityId: apptId,
      summary: `Scheduled visit with ${clampStr(params.doctorName, 60)} on ${params.appointmentDate}`,
      createdAt: serverTimestamp(),
    });

    for (const uid of params.memberUids.slice(0, 10)) {
      if (uid === params.actor.uid) continue;
      const notifId = generateId('ntf');
      batch.set(doc(db, 'notifications', notifId), {
        id: notifId,
        groupId: params.groupId,
        recipientUid: uid,
        type: 'upcoming_appointment',
        title: `New Appointment: ${clampStr(params.doctorName, 60)}`,
        message: `${params.appointmentDate} at ${params.appointmentTime} (${params.clinicName})`,
        channel: 'in_app',
        deliveryStatus: 'sent',
        dedupeKey: `apt_${apptId}_${uid}`,
        read: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();
    return apptId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `appointments/${apptId}`);
  }
}

export async function updateAppointment(
  apptId: string,
  groupId: string,
  memberUids: string[],
  patch: Partial<Appointment> & { status?: AppointmentStatus },
  actor: { uid: string; name: string; role: UserRole },
): Promise<void> {
  const path = `appointments/${apptId}`;
  try {
    const batch = writeBatch(db);
    const clean: Record<string, unknown> = {
      updatedBy: actor.uid,
      updatedAt: serverTimestamp(),
    };
    if (patch.doctorName !== undefined) clean.doctorName = clampStr(patch.doctorName, 120);
    if (patch.specialty !== undefined) clean.specialty = clampStr(patch.specialty, 80);
    if (patch.clinicName !== undefined) clean.clinicName = clampStr(patch.clinicName, 160);
    if (patch.appointmentDate !== undefined) clean.appointmentDate = patch.appointmentDate.slice(0, 10);
    if (patch.appointmentTime !== undefined) clean.appointmentTime = patch.appointmentTime.slice(0, 5);
    if (patch.timezone !== undefined) clean.timezone = clampStr(patch.timezone, 64);
    if (patch.notes !== undefined) clean.notes = clampStr(patch.notes, 500);
    if (patch.reminderMinutesBefore !== undefined) {
      clean.reminderMinutesBefore = Math.max(0, Math.min(10080, Math.round(patch.reminderMinutesBefore)));
    }
    if (patch.status !== undefined) clean.status = patch.status;

    batch.update(doc(db, 'appointments', apptId), clean);

    const actId = generateId('act');
    batch.set(doc(db, 'activityLogs', actId), {
      id: actId,
      groupId,
      memberUids: memberUids.slice(0, 20),
      actorUid: actor.uid,
      actorName: clampStr(actor.name, 120) || 'User',
      actorRole: actor.role,
      actionType: `APPOINTMENT_${(patch.status ?? 'updated').toUpperCase()}`,
      entityType: 'appointment',
      entityId: apptId,
      summary: `Appointment ${patch.status ?? 'updated'} for ${patch.doctorName ?? 'visit'}`,
      createdAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function createInAppNotification(params: {
  groupId: string;
  recipientUid: string;
  type: NotificationRecord['type'];
  title: string;
  message: string;
  channel: 'in_app' | 'email';
  deliveryStatus: NotificationRecord['deliveryStatus'];
  dedupeKey: string;
}): Promise<void> {
  const notifId = generateId('ntf');
  try {
    await setDoc(doc(db, 'notifications', notifId), {
      id: notifId,
      groupId: params.groupId,
      recipientUid: params.recipientUid,
      type: params.type,
      title: clampStr(params.title, 140) || 'CareBridge Reminder',
      message: clampStr(params.message, 500) || 'You have a new update.',
      channel: params.channel,
      deliveryStatus: params.deliveryStatus,
      dedupeKey: clampStr(params.dedupeKey, 180) || notifId,
      read: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `notifications/${notifId}`);
  }
}

export async function markNotificationRead(notifId: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'notifications', notifId), {
      read: true,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `notifications/${notifId}`);
  }
}

export async function markAllNotificationsRead(notifs: NotificationRecord[]): Promise<void> {
  const unread = notifs.filter((n) => !n.read).slice(0, 50);
  if (unread.length === 0) return;
  try {
    const batch = writeBatch(db);
    for (const n of unread) {
      batch.update(doc(db, 'notifications', n.id), {
        read: true,
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'notifications');
  }
}

export async function updateNotificationPreferences(
  uid: string,
  prefs: Omit<NotificationPreference, 'uid' | 'updatedAt'>,
): Promise<void> {
  try {
    await setDoc(doc(db, 'notificationPreferences', uid), {
      uid,
      ...prefs,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `notificationPreferences/${uid}`);
  }
}

export async function fetchNotificationPreferences(uid: string): Promise<NotificationPreference | null> {
  try {
    const snap = await getDoc(doc(db, 'notificationPreferences', uid));
    return snap.exists() ? (snap.data() as NotificationPreference) : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `notificationPreferences/${uid}`);
  }
}

export async function seedFictionalDemoCareProfile(params: {
  ownerUid: string;
  ownerName: string;
  ownerRole: UserRole;
  timezone: string;
}): Promise<string> {
  const groupId = await createCareGroup({
    ownerUid: params.ownerUid,
    ownerName: params.ownerName,
    ownerRole: params.ownerRole,
    elderlyName: 'Shri Raghavan Iyer (Demo)',
    elderlyAge: 76,
    bloodGroup: 'O+',
    primaryPhysician: 'Dr. Ananya Nair',
    primaryClinic: 'Sankara Heart & Senior Care Clinic',
    timezone: params.timezone,
    allergies: ['Penicillin', 'Sulfa drugs'],
    conditions: ['Type 2 Diabetes (Managed)', 'Mild Hypertension'],
  });

  const todayStr = getTodayDateKey(params.timezone);
  const [y, m, dNum] = todayStr.split('-').map(Number);
  const baseUtc = new Date(Date.UTC(y, (m || 1) - 1, dNum || 1));
  const plusDays = (days: number) => {
    const copy = new Date(baseUtc);
    copy.setUTCDate(copy.getUTCDate() + days);
    return copy.toISOString().slice(0, 10);
  };

  const med1 = await addMedication({
    groupId,
    memberUids: [params.ownerUid],
    name: 'Metformin',
    dosage: '500 mg tablet',
    scheduleTimes: ['08:00', '20:00'],
    frequency: 'twice_daily',
    startDate: plusDays(-30),
    instructions: 'Take after breakfast and dinner with a full glass of water.',
    prescriberName: 'Dr. Ananya Nair',
    prescriberClinic: 'Sankara Senior Care Clinic',
    actor: { uid: params.ownerUid, name: params.ownerName, role: params.ownerRole },
  });

  const med2 = await addMedication({
    groupId,
    memberUids: [params.ownerUid],
    name: 'Amlodipine',
    dosage: '5 mg tablet',
    scheduleTimes: ['09:00'],
    frequency: 'once_daily',
    startDate: plusDays(-30),
    instructions: 'Take once every morning as directed.',
    prescriberName: 'Dr. Ananya Nair',
    prescriberClinic: 'Sankara Senior Care Clinic',
    actor: { uid: params.ownerUid, name: params.ownerName, role: params.ownerRole },
  });

  const med3 = await addMedication({
    groupId,
    memberUids: [params.ownerUid],
    name: 'Atorvastatin',
    dosage: '10 mg tablet',
    scheduleTimes: ['21:30'],
    frequency: 'once_daily',
    startDate: plusDays(-30),
    instructions: 'Take before bedtime.',
    prescriberName: 'Dr. Vikram Joshi',
    prescriberClinic: 'City Polyclinic',
    actor: { uid: params.ownerUid, name: params.ownerName, role: params.ownerRole },
  });

  // Record 6 days of realistic historical dose confirmations
  for (let offset = -5; offset <= 0; offset++) {
    const dStr = plusDays(offset);
    await recordDoseStatus({
      groupId,
      memberUids: [params.ownerUid],
      medicationId: med1,
      medicationName: 'Metformin',
      scheduledDate: dStr,
      scheduledTime: '08:00',
      status: offset === -2 ? 'skipped' : 'taken',
      actor: { uid: params.ownerUid, name: params.ownerName, role: params.ownerRole },
    });
    if (offset < 0) {
      await recordDoseStatus({
        groupId,
        memberUids: [params.ownerUid],
        medicationId: med2,
        medicationName: 'Amlodipine',
        scheduledDate: dStr,
        scheduledTime: '09:00',
        status: 'taken',
        actor: { uid: params.ownerUid, name: params.ownerName, role: params.ownerRole },
      });
      await recordDoseStatus({
        groupId,
        memberUids: [params.ownerUid],
        medicationId: med3,
        medicationName: 'Atorvastatin',
        scheduledDate: dStr,
        scheduledTime: '21:30',
        status: offset === -4 ? 'missed' : 'taken',
        actor: { uid: params.ownerUid, name: params.ownerName, role: params.ownerRole },
      });
    }
  }

  await createAppointment({
    groupId,
    memberUids: [params.ownerUid],
    doctorName: 'Dr. Ananya Nair',
    specialty: 'Geriatric Cardiology',
    clinicName: 'Sankara Heart & Senior Care Clinic',
    appointmentDate: plusDays(3),
    appointmentTime: '10:30',
    timezone: params.timezone,
    notes: 'Bring 7-day blood pressure notebook and updated medication list.',
    reminderMinutesBefore: 120,
    actor: { uid: params.ownerUid, name: params.ownerName, role: params.ownerRole },
  });

  await createAppointment({
    groupId,
    memberUids: [params.ownerUid],
    doctorName: 'Dr. Vikram Joshi',
    specialty: 'General Medicine',
    clinicName: 'City Polyclinic',
    appointmentDate: plusDays(12),
    appointmentTime: '16:00',
    timezone: params.timezone,
    notes: 'Routine quarterly wellness review.',
    reminderMinutesBefore: 60,
    actor: { uid: params.ownerUid, name: params.ownerName, role: params.ownerRole },
  });

  return groupId;
}

// =========================================================================
// Real-Time Subscriptions (only attached when authenticated)
// =========================================================================

export function subscribeUserMemberships(
  uid: string,
  onData: (memberships: CareMembership[]) => void,
  onError?: (err: unknown) => void,
): Unsubscribe {
  const q = query(collection(db, 'careMemberships'), where('uid', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => d.data() as CareMembership)
        .filter((m) => m.status === 'active');
      onData(items);
    },
    (error) => {
      logFirestoreError(error, OperationType.LIST, 'careMemberships');
      onError?.(error);
    },
  );
}

export function subscribeCareGroup(
  uid: string,
  groupId: string,
  onData: (group: CareGroup | null) => void,
  onError?: (err: unknown) => void,
): Unsubscribe {
  const q = query(
    collection(db, 'careGroups'),
    where('memberUids', 'array-contains', uid),
    limit(25),
  );
  return onSnapshot(
    q,
    (snap) => {
      const match =
        snap.docs.map((d) => d.data() as CareGroup).find((g) => g.id === groupId) ?? null;
      onData(match);
    },
    (error) => {
      logFirestoreError(error, OperationType.LIST, `careGroups/${groupId}`);
      onError?.(error);
    },
  );
}

export function subscribeGroupMedications(
  uid: string,
  groupId: string,
  onData: (meds: Medication[]) => void,
  onError?: (err: unknown) => void,
): Unsubscribe {
  const q = query(
    collection(db, 'medications'),
    where('memberUids', 'array-contains', uid),
    limit(150),
  );
  return onSnapshot(
    q,
    (snap) =>
      onData(
        snap.docs
          .map((d) => d.data() as Medication)
          .filter((m) => m.groupId === groupId),
      ),
    (error) => {
      logFirestoreError(error, OperationType.LIST, 'medications');
      onError?.(error);
    },
  );
}

export function subscribeGroupMedicationLogs(
  uid: string,
  groupId: string,
  onData: (logs: MedicationLog[]) => void,
  onError?: (err: unknown) => void,
): Unsubscribe {
  const q = query(
    collection(db, 'medicationLogs'),
    where('memberUids', 'array-contains', uid),
    limit(200),
  );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => d.data() as MedicationLog)
        .filter((l) => l.groupId === groupId);
      items.sort((a, b) => {
        const keyA = `${a.scheduledDate} ${a.scheduledTime}`;
        const keyB = `${b.scheduledDate} ${b.scheduledTime}`;
        return keyB.localeCompare(keyA);
      });
      onData(items);
    },
    (error) => {
      logFirestoreError(error, OperationType.LIST, 'medicationLogs');
      onError?.(error);
    },
  );
}

export function subscribeGroupAppointments(
  uid: string,
  groupId: string,
  onData: (appts: Appointment[]) => void,
  onError?: (err: unknown) => void,
): Unsubscribe {
  const q = query(
    collection(db, 'appointments'),
    where('memberUids', 'array-contains', uid),
    limit(120),
  );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => d.data() as Appointment)
        .filter((a) => a.groupId === groupId);
      items.sort((a, b) =>
        `${a.appointmentDate} ${a.appointmentTime}`.localeCompare(
          `${b.appointmentDate} ${b.appointmentTime}`,
        ),
      );
      onData(items);
    },
    (error) => {
      logFirestoreError(error, OperationType.LIST, 'appointments');
      onError?.(error);
    },
  );
}

export function subscribeUserNotifications(
  uid: string,
  onData: (notifs: NotificationRecord[]) => void,
  onError?: (err: unknown) => void,
): Unsubscribe {
  const q = query(
    collection(db, 'notifications'),
    where('recipientUid', '==', uid),
    limit(60),
  );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => d.data() as NotificationRecord);
      items.sort((a, b) => {
        const ta = (a.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
        const tb = (b.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
        return tb - ta;
      });
      onData(items);
    },
    (error) => {
      logFirestoreError(error, OperationType.LIST, 'notifications');
      onError?.(error);
    },
  );
}

export function subscribeGroupActivityLogs(
  uid: string,
  groupId: string,
  onData: (logs: ActivityLog[]) => void,
  onError?: (err: unknown) => void,
): Unsubscribe {
  const q = query(
    collection(db, 'activityLogs'),
    where('memberUids', 'array-contains', uid),
    limit(120),
  );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => d.data() as ActivityLog)
        .filter((l) => l.groupId === groupId);
      items.sort((a, b) => {
        const ta = (a.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
        const tb = (b.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
        return tb - ta;
      });
      onData(items);
    },
    (error) => {
      logFirestoreError(error, OperationType.LIST, 'activityLogs');
      onError?.(error);
    },
  );
}

export async function fetchMyInvitations(uid: string): Promise<Invitation[]> {
  try {
    const q = query(collection(db, 'invitations'), where('createdBy', '==', uid), limit(30));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as Invitation);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'invitations');
  }
}

export async function getAuthenticatedIdToken(): Promise<string | null> {
  if (!auth.currentUser) return null;
  return auth.currentUser.getIdToken();
}
