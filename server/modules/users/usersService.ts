import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { adminAuth, adminDb, FieldValue } from '../../config/firebase.ts';
import { assertActiveMember } from '../../middleware/authorization.ts';
import { AppError } from '../../middleware/errorHandler.ts';
import { clampStr, generateDocId, sanitizeId } from '../../utils/idAndDate.ts';

export interface UserProfileRecord {
  uid: string;
  displayName: string;
  role: 'elderly' | 'family' | 'caregiver';
  preferredLanguage: string;
  preferredScript?: string;
  timezone: string;
  largeText?: boolean;
  highContrast?: boolean;
  largeButtons?: boolean;
  simpleNavigation?: boolean;
  reducedMotion?: boolean;
  voiceEnabled?: boolean;
  activeGroupId?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface UserPrivateRecord {
  uid: string;
  email: string;
  phone?: string;
  emergencyContact?: string;
  address?: string;
  updatedAt?: unknown;
}

export interface UpdateUserMePayload {
  displayName?: string;
  preferredLanguage?: string;
  preferredScript?: string;
  timezone?: string;
  largeText?: boolean;
  highContrast?: boolean;
  largeButtons?: boolean;
  simpleNavigation?: boolean;
  reducedMotion?: boolean;
  voiceEnabled?: boolean;
  activeGroupId?: string;
  phone?: string;
  emergencyContact?: string;
  address?: string;
}

export async function getMyProfile(
  uid: string,
  db: Firestore = adminDb,
): Promise<{
  profile: UserProfileRecord | null;
  privateInfo: UserPrivateRecord | null;
  memberships: Array<Record<string, unknown>>;
}> {
  const [userSnap, privateSnap, membershipsSnap] = await Promise.all([
    db.doc(`users/${uid}`).get(),
    db.doc(`users/${uid}/private/info`).get(),
    db.collection('careMemberships').where('uid', '==', uid).get(),
  ]);

  const memberships = membershipsSnap.docs
    .map((d) => d.data() as Record<string, unknown>)
    .filter((m) => m.status === 'active');

  return {
    profile: userSnap.exists ? (userSnap.data() as UserProfileRecord) : null,
    privateInfo: privateSnap.exists ? (privateSnap.data() as UserPrivateRecord) : null,
    memberships,
  };
}

export async function updateMyProfile(
  uid: string,
  email: string | undefined,
  payload: UpdateUserMePayload,
  db: Firestore = adminDb,
): Promise<{ profile: UserProfileRecord; privateInfo: UserPrivateRecord | null }> {
  const userRef = db.doc(`users/${uid}`);
  const privateRef = db.doc(`users/${uid}/private/info`);
  const userSnap = await userRef.get();

  if (!userSnap.exists) {
    throw AppError.notFound('User profile has not been initialized yet.');
  }

  if (payload.activeGroupId) {
    await assertActiveMember(payload.activeGroupId, uid, db);
  }

  const profilePatch: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (payload.displayName !== undefined) profilePatch.displayName = clampStr(payload.displayName, 120);
  if (payload.preferredLanguage !== undefined) profilePatch.preferredLanguage = clampStr(payload.preferredLanguage, 16);
  if (payload.preferredScript !== undefined) profilePatch.preferredScript = clampStr(payload.preferredScript, 32);
  if (payload.timezone !== undefined) profilePatch.timezone = clampStr(payload.timezone, 64);
  if (payload.largeText !== undefined) profilePatch.largeText = payload.largeText;
  if (payload.highContrast !== undefined) profilePatch.highContrast = payload.highContrast;
  if (payload.largeButtons !== undefined) profilePatch.largeButtons = payload.largeButtons;
  if (payload.simpleNavigation !== undefined) profilePatch.simpleNavigation = payload.simpleNavigation;
  if (payload.reducedMotion !== undefined) profilePatch.reducedMotion = payload.reducedMotion;
  if (payload.voiceEnabled !== undefined) profilePatch.voiceEnabled = payload.voiceEnabled;
  if (payload.activeGroupId !== undefined) profilePatch.activeGroupId = payload.activeGroupId;

  const batch = db.batch();
  batch.update(userRef, profilePatch);

  const hasPrivateFields =
    payload.phone !== undefined ||
    payload.emergencyContact !== undefined ||
    payload.address !== undefined;

  if (hasPrivateFields) {
    const privatePatch: Record<string, unknown> = {
      uid,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (email) privatePatch.email = clampStr(email, 254);
    if (payload.phone !== undefined) privatePatch.phone = clampStr(payload.phone, 32);
    if (payload.emergencyContact !== undefined) {
      privatePatch.emergencyContact = clampStr(payload.emergencyContact, 160);
    }
    if (payload.address !== undefined) privatePatch.address = clampStr(payload.address, 250);
    batch.set(privateRef, privatePatch, { merge: true });
  }

  await batch.commit();

  const [updatedProfile, updatedPrivate] = await Promise.all([userRef.get(), privateRef.get()]);
  return {
    profile: updatedProfile.data() as UserProfileRecord,
    privateInfo: updatedPrivate.exists ? (updatedPrivate.data() as UserPrivateRecord) : null,
  };
}

export async function deleteMyAccount(
  uid: string,
  db: Firestore = adminDb,
  authClient: Auth = adminAuth,
): Promise<{ deleted: true; uid: string; groupsUpdated: number }> {
  const userSnap = await db.doc(`users/${uid}`).get();
  const profile = userSnap.exists ? (userSnap.data() as UserProfileRecord) : null;

  const membershipsSnap = await db.collection('careMemberships').where('uid', '==', uid).get();
  const batch = db.batch();
  let groupsUpdated = 0;

  for (const membershipDoc of membershipsSnap.docs) {
    const mData = membershipDoc.data() as { groupId?: string; status?: string };
    const groupId = mData.groupId;
    if (!groupId) continue;

    batch.update(membershipDoc.ref, {
      status: 'revoked',
      updatedAt: FieldValue.serverTimestamp(),
    });

    const memberRef = db.doc(`careGroups/${groupId}/members/${uid}`);
    const memberSnap = await memberRef.get();
    if (memberSnap.exists) {
      batch.update(memberRef, {
        status: 'revoked',
        canEditMedications: false,
        canEditAppointments: false,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    const groupRef = db.doc(`careGroups/${groupId}`);
    const groupSnap = await groupRef.get();
    if (groupSnap.exists) {
      const groupData = groupSnap.data() as { memberUids?: string[] };
      const remaining = (groupData.memberUids ?? []).filter((id) => id !== uid);
      if (remaining.length > 0) {
        batch.update(groupRef, {
          memberUids: remaining,
          updatedAt: FieldValue.serverTimestamp(),
        });

        const logId = generateDocId('act');
        batch.set(db.doc(`activityLogs/${logId}`), {
          id: logId,
          groupId,
          memberUids: remaining,
          actorUid: uid,
          actorName: profile?.displayName || 'Former Member',
          actorRole: profile?.role || 'family',
          actionType: 'ACCOUNT_DELETED',
          entityType: 'member',
          entityId: sanitizeId(uid),
          summary: 'Member deleted their CareBridge account and exited the group.',
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      groupsUpdated++;
    }
  }

  batch.delete(db.doc(`users/${uid}/private/info`));
  batch.delete(db.doc(`notificationPreferences/${uid}`));
  if (userSnap.exists) {
    batch.delete(db.doc(`users/${uid}`));
  }

  await batch.commit();

  try {
    await authClient.revokeRefreshTokens(uid);
  } catch {
    // Non-fatal in test/emulated contexts
  }

  return {
    deleted: true,
    uid,
    groupsUpdated,
  };
}
