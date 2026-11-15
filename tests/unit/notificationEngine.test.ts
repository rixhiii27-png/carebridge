import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildPrivacySafeEmailBody,
  buildPrivacySafeSubject,
  maskEmail,
  sendCareNotificationEmail,
} from '../../server/services/emailService.ts';
import {
  clearDedupeCacheForTests,
  dispatchNotificationWithGuards,
  formatTimezoneDateKey,
  withExponentialRetry,
} from '../../server/services/notificationEngine.ts';

describe('Notification Engine & Privacy-Safe Email Service', () => {
  beforeEach(() => {
    clearDedupeCacheForTests();
  });

  it('generates neutral privacy-safe email subjects and bodies without protected medical details', () => {
    const types = [
      'upcoming_dose',
      'unconfirmed_dose',
      'missed_dose',
      'upcoming_appointment',
      'caregiver_update',
    ];

    for (const type of types) {
      const subject = buildPrivacySafeSubject(type);
      expect(subject.startsWith('CareBridge:')).toBe(true);
      expect(subject.toLowerCase()).not.toContain('metformin');
      expect(subject.toLowerCase()).not.toContain('diagnosis');
      expect(subject.toLowerCase()).not.toContain('mg');
    }

    const body = buildPrivacySafeEmailBody('https://carebridge.example.app');
    expect(body).toContain('protected medication and appointment details are never included');
    expect(body).toContain('https://carebridge.example.app');
  });

  it('masks email addresses before recording delivery logs', () => {
    expect(maskEmail('aarav.sharma@example.com')).toBe('aa***@example.com');
    expect(maskEmail('invalid-email')).toBe('***');
  });

  it('reports EMAIL_TEST_MODE honestly without claiming external SMTP transmission', async () => {
    const result = await sendCareNotificationEmail({
      to: 'caregiver@example.com',
      notificationType: 'upcoming_dose',
    });

    expect(result.mode).toBe('test');
    expect(result.sent).toBe(false);
    expect(result.recipientMasked).toBe('ca***@example.com');
    expect(result.reason).toContain('EMAIL_TEST_MODE');
  });

  it('prevents duplicate notification dispatches using dedupeKey', async () => {
    const first = await dispatchNotificationWithGuards({
      groupId: 'grp_demo_01',
      type: 'upcoming_dose',
      dedupeKey: 'grp_demo_01_med1_08:00_2026-04-15',
      sendEmail: true,
      recipientEmail: 'family@example.com',
      timezone: 'Asia/Kolkata',
    });

    expect(first.duplicate).toBe(false);
    expect(first.record.inAppStatus).toBe('sent');

    const second = await dispatchNotificationWithGuards({
      groupId: 'grp_demo_01',
      type: 'upcoming_dose',
      dedupeKey: 'grp_demo_01_med1_08:00_2026-04-15',
      sendEmail: true,
      recipientEmail: 'family@example.com',
      timezone: 'Asia/Kolkata',
    });

    expect(second.duplicate).toBe(true);
    expect(second.record.inAppStatus).toBe('skipped_preference');
    expect(second.record.attempts).toBe(0);
  });

  it('retries transient errors up to maxAttempts with exponential backoff', async () => {
    const op = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('Transient SMTP timeout'))
      .mockResolvedValueOnce('delivered');

    const res = await withExponentialRetry(op, 3, 5);
    expect(res.result).toBe('delivered');
    expect(res.attempts).toBe(2);
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('computes timezone-aware YYYY-MM-DD date keys', () => {
    // 2026-04-15T20:00:00Z is already 2026-04-16 in Asia/Kolkata (UTC+05:30)
    const utcEvening = new Date('2026-04-15T20:00:00.000Z');
    expect(formatTimezoneDateKey(utcEvening, 'UTC')).toBe('2026-04-15');
    expect(formatTimezoneDateKey(utcEvening, 'Asia/Kolkata')).toBe('2026-04-16');
  });
});
