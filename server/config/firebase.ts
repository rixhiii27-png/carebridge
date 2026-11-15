import { getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { loadFirebaseConfig } from './env.ts';

export const firebaseConfig = loadFirebaseConfig();

function getOrInitializeAdminApp(): App {
  if (getApps().length === 0) {
    return initializeApp({
      projectId: firebaseConfig.projectId,
    });
  }
  return getApps()[0];
}

export const adminApp: App = getOrInitializeAdminApp();
export const adminAuth: Auth = getAuth(adminApp);
export const adminDb: Firestore = getFirestore(adminApp, firebaseConfig.firestoreDatabaseId);
export { FieldValue, Timestamp };
