import { cert, getApps, initializeApp, type App, type ServiceAccount } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { loadFirebaseConfig, serverEnv } from './env.ts';

export const firebaseConfig = loadFirebaseConfig();

export interface ParsedServiceAccount extends ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

export function parseAndValidateServiceAccountJson(
  rawJson: string,
  expectedProjectId?: string,
): ParsedServiceAccount {
  const trimmed = rawJson.trim();
  if (!trimmed) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is empty.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(
      'Invalid FIREBASE_SERVICE_ACCOUNT_JSON: value must be valid JSON.',
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      'Invalid FIREBASE_SERVICE_ACCOUNT_JSON: expected a JSON service account object.',
    );
  }

  const record = parsed as Record<string, unknown>;
  const projectId = typeof record.project_id === 'string' ? record.project_id.trim() : '';
  const clientEmail = typeof record.client_email === 'string' ? record.client_email.trim() : '';
  const rawPrivateKey = typeof record.private_key === 'string' ? record.private_key : '';
  const privateKey = rawPrivateKey.replace(/\\n/g, '\n').trim();

  if (!projectId) {
    throw new Error('Invalid FIREBASE_SERVICE_ACCOUNT_JSON: missing project_id.');
  }
  if (!clientEmail || !clientEmail.includes('@')) {
    throw new Error('Invalid FIREBASE_SERVICE_ACCOUNT_JSON: missing or invalid client_email.');
  }
  if (!privateKey || !privateKey.includes('BEGIN PRIVATE KEY') || !privateKey.includes('END PRIVATE KEY')) {
    throw new Error('Invalid FIREBASE_SERVICE_ACCOUNT_JSON: missing or malformed private_key.');
  }
  if (expectedProjectId && projectId !== expectedProjectId) {
    throw new Error(
      `FIREBASE_SERVICE_ACCOUNT_JSON project_id mismatch: expected "${expectedProjectId}".`,
    );
  }

  return {
    projectId,
    clientEmail,
    privateKey,
    project_id: projectId,
    client_email: clientEmail,
    private_key: privateKey,
  };
}

function getOrInitializeAdminApp(): App {
  if (getApps().length === 0) {
    const rawServiceAccount = serverEnv.firebaseServiceAccountJson.trim();
    if (rawServiceAccount) {
      const serviceAccount = parseAndValidateServiceAccountJson(
        rawServiceAccount,
        firebaseConfig.projectId,
      );
      return initializeApp({
        credential: cert(serviceAccount),
        projectId: firebaseConfig.projectId,
      });
    }

    // Retain ADC / local Google Cloud environment support when FIREBASE_SERVICE_ACCOUNT_JSON is unset
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
