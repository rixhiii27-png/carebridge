import { adminDb } from '../config/firebase.ts';

export async function isActiveGroupMemberAdmin(groupId: string, uid: string): Promise<boolean> {
  const memberSnap = await adminDb.doc(`careGroups/${groupId}/members/${uid}`).get();
  if (!memberSnap.exists) return false;
  const data = memberSnap.data() as { status?: string } | undefined;
  return data?.status === 'active';
}
