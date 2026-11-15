import type { Firestore } from 'firebase-admin/firestore';
import { adminDb, FieldValue } from '../../config/firebase.ts';
import {
  assertActiveMember,
  assertGroupOwner,
  type CareGroupDoc,
  type CareMemberDoc,
} from '../../middleware/authorization.ts';
import { AppError } from '../../middleware/errorHandler.ts';
import {
  clampStr,
  generateDocId,
  generateSecureInviteToken,
  hashToken,
  sanitizeId,
} from '../../utils/idAndDate.ts';

export async function listUserCareGroups(
  uid: string,
  db: Firestore = adminDb,
): Promise<CareGroupDoc[]> {
  const groupsSnap = await db
    .collection('careGroups')
    .where('memberUids', 'array-contains', uid)
    .limit(25)
    .get();

  return groupsSnap.docs.map((d) => d.data() as CareGroupDoc);
}

export async function createCareGroupAdmin(
  params: {
    ownerUid: string;
    ownerName: string;
    ownerRole: 'elderly' | 'family' | 'caregiver';
    elderlyName: string;
    elderlyAge: number;
    bloodGroup?: string;
    primaryPhysician?: string;
    primaryClinic?: string;
    timezone: string;
    allergies?: string[];
    conditions?: string[];
  },
  db: Firestore = adminDb,
): Promise<CareGroupDoc> {
  const groupId = generateDocId('grp');
  const membershipId = sanitizeId(`${groupId}_${params.ownerUid}`);
  const logId = generateDocId('act');

  const groupPayload: CareGroupDoc = {
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
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  const batch = db.batch();
  batch.set(db.doc(`careGroups/${groupId}`), groupPayload);
  batch.set(db.doc(`careGroups/${groupId}/members/${params.ownerUid}`), {
    uid: params.ownerUid,
    groupId,
    displayName: clampStr(params.ownerName, 120) || 'Owner',
    role: params.ownerRole,
    relationship: params.ownerRole === 'elderly' ? 'Self' : 'Care Coordinator',
    canEditMedications: true,
    canEditAppointments: true,
    status: 'active',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  batch.set(db.doc(`careMemberships/${membershipId}`), {
    uid: params.ownerUid,
    groupId,
    elderlyName: groupPayload.elderlyName,
    role: params.ownerRole,
    status: 'active',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  batch.set(db.doc(`activityLogs/${logId}`), {
    id: logId,
    groupId,
    memberUids: [params.ownerUid],
    actorUid: params.ownerUid,
    actorName: clampStr(params.ownerName, 120) || 'Owner',
    actorRole: params.ownerRole,
    actionType: 'CARE_GROUP_CREATED',
    entityType: 'careGroup',
    entityId: groupId,
    summary: `Created care group for ${groupPayload.elderlyName}`,
    createdAt: FieldValue.serverTimestamp(),
  });

  const userRef = db.doc(`users/${params.ownerUid}`);
  const userSnap = await userRef.get();
  if (userSnap.exists) {
    batch.update(userRef, {
      activeGroupId: groupId,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();
  const createdSnap = await db.doc(`careGroups/${groupId}`).get();
  return createdSnap.data() as CareGroupDoc;
}

export async function getGroupMembersAdmin(
  groupId: string,
  actorUid: string,
  db: Firestore = adminDb,
): Promise<CareMemberDoc[]> {
  await assertActiveMember(groupId, actorUid, db);
  const membersSnap = await db.collection(`careGroups/${groupId}/members`).get();
  return membersSnap.docs.map((d) => d.data() as CareMemberDoc);
}

export async function createInvitationAdmin(
  params: {
    groupId: string;
    actorUid: string;
    actorName: string;
    actorRole: 'elderly' | 'family' | 'caregiver';
    targetRole: 'family' | 'caregiver';
    canEditMedications: boolean;
    canEditAppointments: boolean;
    invitedEmail?: string;
    expiresInHours?: number;
  },
  db: Firestore = adminDb,
): Promise<{
  invitationId: string;
  token: string;
  groupId: string;
  targetRole: 'family' | 'caregiver';
  expiresAtMs: number;
}> {
  const { group } = await assertGroupOwner(params.groupId, params.actorUid, db);
  const { plaintextToken, tokenHash } = generateSecureInviteToken();
  const invitationId = generateDocId('inv');
  const maskedCode = `INV-${invitationId.slice(-8).toUpperCase()}`;
  const expiresAtMs = Date.now() + (params.expiresInHours ?? 24) * 60 * 60 * 1000;

  const inviteDoc: Record<string, unknown> = {
    code: maskedCode,
    tokenHash,
    groupId: params.groupId,
    elderlyName: group.elderlyName,
    createdBy: params.actorUid,
    targetRole: params.targetRole,
    canEditMedications: params.canEditMedications,
    canEditAppointments: params.canEditAppointments,
    status: 'pending',
    expiresAtMs,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (params.invitedEmail) {
    inviteDoc.invitedEmail = params.invitedEmail.trim().toLowerCase();
  }

  const batch = db.batch();
  batch.set(db.doc(`invitations/${invitationId}`), inviteDoc);

  const actId = generateDocId('act');
  batch.set(db.doc(`activityLogs/${actId}`), {
    id: actId,
    groupId: params.groupId,
    memberUids: group.memberUids,
    actorUid: params.actorUid,
    actorName: clampStr(params.actorName, 120) || 'Owner',
    actorRole: params.actorRole,
    actionType: 'INVITATION_CREATED',
    entityType: 'invitation',
    entityId: invitationId,
    summary: `Issued single-use ${params.targetRole} invitation`,
    createdAt: FieldValue.serverTimestamp(),
  });

  await batch.commit();

  return {
    invitationId,
    token: plaintextToken,
    groupId: params.groupId,
    targetRole: params.targetRole,
    expiresAtMs,
  };
}

export async function redeemInvitationAdmin(
  params: {
    tokenOrCode: string;
    uid: string;
    email?: string;
    displayName: string;
    relationship?: string;
  },
  db: Firestore = adminDb,
): Promise<{ groupId: string; role: 'family' | 'caregiver' }> {
  const rawInput = params.tokenOrCode.trim();
  const hashed = hashToken(rawInput);

  let inviteDocId: string | null = null;
  const byHashSnap = await db.collection('invitations').where('tokenHash', '==', hashed).limit(1).get();
  if (!byHashSnap.empty) {
    inviteDocId = byHashSnap.docs[0].id;
  } else {
    const cleanCode = rawInput.toUpperCase().replace(/[^A-Z0-9-]/g, '');
    if (cleanCode.length >= 8) {
      const legacySnap = await db.doc(`invitations/${cleanCode}`).get();
      if (legacySnap.exists) {
        inviteDocId = legacySnap.id;
      }
    }
  }

  if (!inviteDocId) {
    throw AppError.notFound('Invitation token not found.');
  }

  const inviteRef = db.doc(`invitations/${inviteDocId}`);

  return db.runTransaction(async (tx) => {
    const inviteSnap = await tx.get(inviteRef);
    if (!inviteSnap.exists) {
      throw AppError.notFound('Invitation token not found.');
    }

    const invite = inviteSnap.data() as {
      code: string;
      groupId: string;
      elderlyName: string;
      targetRole: 'family' | 'caregiver';
      canEditMedications: boolean;
      canEditAppointments: boolean;
      status: 'pending' | 'redeemed' | 'revoked';
      invitedEmail?: string;
      expiresAtMs: number;
    };

    if (invite.status !== 'pending') {
      throw AppError.conflict('Invitation has already been redeemed or revoked.');
    }
    if (invite.expiresAtMs <= Date.now()) {
      throw AppError.badRequest('Invitation token has expired.');
    }
    if (invite.invitedEmail) {
      if (!params.email || params.email.trim().toLowerCase() !== invite.invitedEmail.toLowerCase()) {
        throw AppError.forbidden('This invitation was issued for a different verified email address.');
      }
    }

    const groupRef = db.doc(`careGroups/${invite.groupId}`);
    const groupSnap = await tx.get(groupRef);
    if (!groupSnap.exists) {
      throw AppError.notFound('Care group no longer exists.');
    }

    const group = groupSnap.data() as CareGroupDoc;
    if (group.memberUids.length >= 20 && !group.memberUids.includes(params.uid)) {
      throw AppError.badRequest('Care group has reached its maximum active member limit.');
    }

    const nextMemberUids = Array.from(new Set([...group.memberUids, params.uid])).slice(0, 20);
    const membershipId = sanitizeId(`${invite.groupId}_${params.uid}`);
    const actId = generateDocId('act');

    tx.update(inviteRef, {
      status: 'redeemed',
      redeemedBy: params.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });

    tx.set(db.doc(`careGroups/${invite.groupId}/members/${params.uid}`), {
      uid: params.uid,
      groupId: invite.groupId,
      displayName: clampStr(params.displayName, 120) || 'Care Member',
      role: invite.targetRole,
      relationship: clampStr(params.relationship, 64) || invite.targetRole,
      inviteCode: invite.code,
      canEditMedications: invite.canEditMedications,
      canEditAppointments: invite.canEditAppointments,
      status: 'active',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    tx.set(db.doc(`careMemberships/${membershipId}`), {
      uid: params.uid,
      groupId: invite.groupId,
      elderlyName: invite.elderlyName,
      role: invite.targetRole,
      status: 'active',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    tx.update(groupRef, {
      memberUids: nextMemberUids,
      updatedAt: FieldValue.serverTimestamp(),
    });

    const userRef = db.doc(`users/${params.uid}`);
    const userSnap = await tx.get(userRef);
    if (userSnap.exists) {
      tx.update(userRef, {
        activeGroupId: invite.groupId,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    tx.set(db.doc(`activityLogs/${actId}`), {
      id: actId,
      groupId: invite.groupId,
      memberUids: nextMemberUids,
      actorUid: params.uid,
      actorName: clampStr(params.displayName, 120) || 'Member',
      actorRole: invite.targetRole,
      actionType: 'MEMBER_JOINED',
      entityType: 'member',
      entityId: params.uid,
      summary: `${clampStr(params.displayName, 60) || 'Member'} joined via invitation as ${invite.targetRole}`,
      createdAt: FieldValue.serverTimestamp(),
    });

    return {
      groupId: invite.groupId,
      role: invite.targetRole,
    };
  });
}

export async function updateMemberPermissionsAdmin(
  params: {
    groupId: string;
    targetUid: string;
    actorUid: string;
    actorName: string;
    canEditMedications?: boolean;
    canEditAppointments?: boolean;
    status?: 'active' | 'revoked';
  },
  db: Firestore = adminDb,
): Promise<CareMemberDoc> {
  const { group, member: actorMember } = await assertGroupOwner(params.groupId, params.actorUid, db);

  if (params.targetUid === group.ownerId) {
    throw AppError.badRequest('Care group owner permissions or active status cannot be revoked.');
  }

  const targetMemberRef = db.doc(`careGroups/${params.groupId}/members/${params.targetUid}`);
  const targetSnap = await targetMemberRef.get();
  if (!targetSnap.exists) {
    throw AppError.notFound('Care group member not found.');
  }

  const currentTarget = targetSnap.data() as CareMemberDoc;
  const nextStatus = params.status ?? currentTarget.status;
  const nextMedPerm =
    nextStatus === 'revoked' ? false : (params.canEditMedications ?? currentTarget.canEditMedications);
  const nextApptPerm =
    nextStatus === 'revoked' ? false : (params.canEditAppointments ?? currentTarget.canEditAppointments);

  const nextMemberUids =
    nextStatus === 'revoked'
      ? group.memberUids.filter((id) => id !== params.targetUid)
      : Array.from(new Set([...group.memberUids, params.targetUid])).slice(0, 20);

  const membershipId = sanitizeId(`${params.groupId}_${params.targetUid}`);
  const actId = generateDocId('act');

  const batch = db.batch();
  batch.update(targetMemberRef, {
    canEditMedications: nextMedPerm,
    canEditAppointments: nextApptPerm,
    status: nextStatus,
    updatedAt: FieldValue.serverTimestamp(),
  });
  batch.set(
    db.doc(`careMemberships/${membershipId}`),
    {
      uid: params.targetUid,
      groupId: params.groupId,
      elderlyName: group.elderlyName,
      role: currentTarget.role,
      status: nextStatus,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  batch.update(db.doc(`careGroups/${params.groupId}`), {
    memberUids: nextMemberUids,
    updatedAt: FieldValue.serverTimestamp(),
  });
  batch.set(db.doc(`activityLogs/${actId}`), {
    id: actId,
    groupId: params.groupId,
    memberUids: nextMemberUids.length > 0 ? nextMemberUids : [params.actorUid],
    actorUid: params.actorUid,
    actorName: clampStr(params.actorName, 120) || 'Owner',
    actorRole: actorMember.role,
    actionType: nextStatus === 'revoked' ? 'MEMBER_REVOKED' : 'MEMBER_PERMISSIONS_UPDATED',
    entityType: 'member',
    entityId: params.targetUid,
    summary:
      nextStatus === 'revoked'
        ? `Revoked care group access for ${currentTarget.displayName}`
        : `Updated permissions for ${currentTarget.displayName}`,
    createdAt: FieldValue.serverTimestamp(),
  });

  await batch.commit();
  const updated = await targetMemberRef.get();
  return updated.data() as CareMemberDoc;
}

export async function revokeMemberAdmin(
  params: {
    groupId: string;
    targetUid: string;
    actorUid: string;
    actorName: string;
  },
  db: Firestore = adminDb,
): Promise<{ revoked: true; uid: string }> {
  await updateMemberPermissionsAdmin(
    {
      ...params,
      canEditMedications: false,
      canEditAppointments: false,
      status: 'revoked',
    },
    db,
  );
  return { revoked: true, uid: params.targetUid };
}
