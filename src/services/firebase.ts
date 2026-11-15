import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  setPersistence,
} from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

// Ensure authentication session persists reliably across browser refreshes
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn('Unable to set browserLocalPersistence:', err);
});

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function buildFirestoreErrorInfo(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): FirestoreErrorInfo {
  return {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
}

export function logFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): FirestoreErrorInfo {
  const errInfo = buildFirestoreErrorInfo(error, operationType, path);
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  return errInfo;
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const errInfo = logFirestoreError(error, operationType, path);
  throw new Error(JSON.stringify(errInfo));
}

export function formatCareBridgeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || 'Unknown error');

  // Parse structured FirestoreErrorInfo JSON if thrown by handleFirestoreError
  if (raw.startsWith('{') && raw.includes('"operationType"')) {
    try {
      const parsed = JSON.parse(raw) as FirestoreErrorInfo;
      if (parsed.error.toLowerCase().includes('permission')) {
        return 'Permission denied for this care record. Please verify your email or check your care circle role.';
      }
      if (
        parsed.error.toLowerCase().includes('offline') ||
        parsed.error.toLowerCase().includes('unavailable')
      ) {
        return 'Network connection interrupted while reaching CareBridge servers. Please check your internet connection and retry.';
      }
      return parsed.error;
    } catch {
      // fall through
    }
  }

  const lower = raw.toLowerCase();
  if (lower.includes('auth/invalid-email')) {
    return 'Please enter a valid email address.';
  }
  if (lower.includes('auth/email-already-in-use')) {
    return 'An account with this email already exists. Please log in instead.';
  }
  if (lower.includes('auth/weak-password')) {
    return 'Please choose a stronger password (at least 6 characters; 8+ recommended).';
  }
  if (
    lower.includes('auth/invalid-credential') ||
    lower.includes('auth/wrong-password') ||
    lower.includes('auth/user-not-found')
  ) {
    return 'Incorrect email or password. Please check your credentials and try again.';
  }
  if (lower.includes('auth/operation-not-allowed')) {
    return 'Email/password sign-in is not yet enabled in Firebase Console for project carebridge-43267. Please use "Continue with Google" or enable Email/Password under Authentication > Sign-in method.';
  }
  if (lower.includes('auth/popup-closed-by-user')) {
    return 'Sign-in window was closed before completion. Please try again.';
  }
  if (lower.includes('auth/popup-blocked')) {
    return 'Your browser blocked the sign-in popup. Please allow popups for this site and try again.';
  }
  if (lower.includes('auth/network-request-failed') || lower.includes('the client is offline')) {
    return 'Network request failed. Please check your internet connection and try again.';
  }
  if (lower.includes('auth/too-many-requests')) {
    return 'Too many attempts. Please wait a moment before trying again.';
  }
  if (lower.includes('missing or insufficient permissions')) {
    return 'You do not have permission to perform this action on the care circle.';
  }
  return raw;
}

export function getTodayDateKey(timezone = 'Asia/Kolkata'): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export async function testFirestoreConnection(): Promise<{ online: boolean; message?: string }> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return { online: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('the client is offline') || msg.includes('unavailable')) {
      console.error('Firestore connectivity check failed:', msg);
      return { online: false, message: 'Unable to reach Cloud Firestore. Please check your network.' };
    }
    // permission-denied on test/connection confirms the client connected to Firestore and rules evaluated
    return { online: true };
  }
}

testFirestoreConnection();
