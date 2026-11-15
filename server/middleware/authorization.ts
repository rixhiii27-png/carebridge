import type { Firestore } from 'firebase-admin/firestore';
import { adminDb } from '../config/firebase.ts';
import { AppError } from './errorHandler.ts';

export interface CareGroupDoc {
  id: string;
  ownerId: string;
  elderlyName: string;
  elderlyAge: number;
  bloodGroup?: string;
  primaryPhysician?: string;
  primaryClinic?: string;
  timezone: string;
  allergies?: string[];
  conditions?: string[];
  memberUids: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CareMemberDoc {
  uid: string;
  groupId: string;
  displayName: string;
  role: 'elderly' | 'family' | 'caregiver';
  relationship?: string;
  inviteCode?: string;
  canEditMedications: boolean;
  canEditAppointments: boolean;
  status: 'active' | 'revoked';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AuthorizedMembershipContext {
  group: CareGroupDoc;
  member: CareMemberDoc;
}

export async function assertActiveMember(
  groupId: string,
  uid: string,
  db: Firestore = adminDb,
): Promise<AuthorizedMembershipContext> {
  if (!groupId || !uid) {
    throw AppError.forbidden('Care group membership verification failed.');
  }

  const [groupSnap, memberSnap] = await Promise.all([
    db.doc(`careGroups/${groupId}`).get(),
    db.doc(`careGroups/${groupId}/members/${uid}`).get(),
  ]);

  if (!groupSnap.exists) {
    throw AppError.notFound('Care group not found.');
  }

  const group = groupSnap.data() as CareGroupDoc;
  if (!memberSnap.exists) {
    throw AppError.forbidden('Forbidden: you are not a member of this care group.');
  }

  const member = memberSnap.data() as CareMemberDoc;
  if (member.status !== 'active' || !Array.isArray(group.memberUids) || !group.memberUids.includes(uid)) {
    throw AppError.forbidden('Forbidden: your membership in this care group is not active.');
  }

  return { group, member };
}

export async function assertCanEditMedications(
  groupId: string,
  uid: string,
  db: Firestore = adminDb,
): Promise<AuthorizedMembershipContext> {
  const ctx = await assertActiveMember(groupId, uid, db);
  if (ctx.member.role !== 'elderly' && ctx.member.canEditMedications !== true) {
    throw AppError.forbidden('Forbidden: medication edit permission is required for this operation.');
  }
  return ctx;
}

export async function assertCanEditAppointments(
  groupId: string,
  uid: string,
  db: Firestore = adminDb,
): Promise<AuthorizedMembershipContext> {
  const ctx = await assertActiveMember(groupId, uid, db);
  if (ctx.member.role !== 'elderly' && ctx.member.canEditAppointments !== true) {
    throw AppError.forbidden('Forbidden: appointment edit permission is required for this operation.');
  }
  return ctx;
}

export async function assertGroupOwner(
  groupId: string,
  uid: string,
  db: Firestore = adminDb,
): Promise<AuthorizedMembershipContext> {
  const ctx = await assertActiveMember(groupId, uid, db);
  if (ctx.group.ownerId !== uid) {
    throw AppError.forbidden('Forbidden: only the care group owner can perform this action.');
  }
  return ctx;
}
