import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from './firebase.ts';

let overrideDb: Firestore | null = null;
let overrideAuth: Auth | null = null;

export function getBackendDb(): Firestore {
  return overrideDb ?? adminDb;
}

export function getBackendAuth(): Auth {
  return overrideAuth ?? adminAuth;
}

export function setBackendOverridesForTests(opts: {
  db?: Firestore | null;
  auth?: Auth | null;
}): void {
  if (opts.db !== undefined) overrideDb = opts.db;
  if (opts.auth !== undefined) overrideAuth = opts.auth;
}
