import { describe, expect, it } from 'vitest';
import { formatCareBridgeError, getTodayDateKey, OperationType } from '../../src/services/firebase.ts';

describe('Firebase Auth Error Formatting & Timezone Date Keys', () => {
  it('maps Firebase Authentication errors to actionable user-friendly messages', () => {
    expect(formatCareBridgeError(new Error('Firebase: Error (auth/invalid-email).'))).toContain(
      'valid email address',
    );
    expect(formatCareBridgeError(new Error('Firebase: Error (auth/email-already-in-use).'))).toContain(
      'already exists',
    );
    expect(formatCareBridgeError(new Error('Firebase: Error (auth/weak-password).'))).toContain(
      'stronger password',
    );
    expect(formatCareBridgeError(new Error('Firebase: Error (auth/invalid-credential).'))).toContain(
      'Incorrect email or password',
    );
    expect(formatCareBridgeError(new Error('Firebase: Error (auth/operation-not-allowed).'))).toContain(
      'carebridge-43267',
    );
    expect(formatCareBridgeError(new Error('Firebase: Error (auth/popup-closed-by-user).'))).toContain(
      'closed before completion',
    );
    expect(formatCareBridgeError(new Error('Firebase: Error (auth/popup-blocked).'))).toContain(
      'blocked the sign-in popup',
    );
    expect(formatCareBridgeError(new Error('Firebase: Error (auth/network-request-failed).'))).toContain(
      'internet connection',
    );
  });

  it('parses structured JSON FirestoreErrorInfo cleanly', () => {
    const jsonErr = new Error(
      JSON.stringify({
        error: 'Missing or insufficient permissions.',
        operationType: OperationType.WRITE,
        path: 'careGroups/grp_1',
        authInfo: { userId: 'u1' },
      }),
    );
    expect(formatCareBridgeError(jsonErr)).toContain('Permission denied');

    const offlineErr = new Error(
      JSON.stringify({
        error: 'Failed to get document because the client is offline.',
        operationType: OperationType.GET,
        path: 'users/u1',
        authInfo: { userId: 'u1' },
      }),
    );
    expect(formatCareBridgeError(offlineErr)).toContain('Network connection interrupted');
  });

  it('formats YYYY-MM-DD local date keys safely for valid and invalid timezones', () => {
    const keyIst = getTodayDateKey('Asia/Kolkata');
    expect(keyIst).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const fallbackKey = getTodayDateKey('Invalid/Timezone_Name');
    expect(fallbackKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
