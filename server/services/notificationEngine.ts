import { sendCareNotificationEmail, type EmailSendResult } from './emailService.ts';

export type DeliveryStatus = 'pending' | 'sent' | 'failed' | 'skipped_preference';

export interface NotificationDispatchRecord {
  dedupeKey: string;
  groupId: string;
  type: string;
  inAppStatus: DeliveryStatus;
  emailResult?: EmailSendResult;
  attempts: number;
  processedAtIso: string;
  timezone: string;
}

const processedDedupeKeys = new Map<string, number>();
const DEDUPE_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

export function clearDedupeCacheForTests(): void {
  processedDedupeKeys.clear();
}

export function hasDuplicateNotification(dedupeKey: string, nowMs = Date.now()): boolean {
  const recordedAt = processedDedupeKeys.get(dedupeKey);
  if (!recordedAt) return false;
  if (nowMs - recordedAt > DEDUPE_TTL_MS) {
    processedDedupeKeys.delete(dedupeKey);
    return false;
  }
  return true;
}

export function markNotificationProcessed(dedupeKey: string, nowMs = Date.now()): void {
  processedDedupeKeys.set(dedupeKey, nowMs);
}

export async function withExponentialRetry<T>(
  operation: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 150,
): Promise<{ result?: T; attempts: number; error?: string }> {
  let lastError = 'Unknown delivery error';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await operation();
      return { result, attempts: attempt };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * Math.pow(2, attempt - 1)));
      }
    }
  }
  return { attempts: maxAttempts, error: lastError };
}

export function formatTimezoneDateKey(date: Date, timezone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export async function dispatchNotificationWithGuards(params: {
  groupId: string;
  type: string;
  dedupeKey: string;
  sendEmail: boolean;
  recipientEmail?: string;
  timezone: string;
}): Promise<{ duplicate: boolean; record: NotificationDispatchRecord }> {
  if (hasDuplicateNotification(params.dedupeKey)) {
    return {
      duplicate: true,
      record: {
        dedupeKey: params.dedupeKey,
        groupId: params.groupId,
        type: params.type,
        inAppStatus: 'skipped_preference',
        attempts: 0,
        processedAtIso: new Date().toISOString(),
        timezone: params.timezone,
      },
    };
  }

  let emailResult: EmailSendResult | undefined;
  let attempts = 1;

  if (params.sendEmail && params.recipientEmail) {
    const retryRes = await withExponentialRetry(() =>
      sendCareNotificationEmail({
        to: params.recipientEmail!,
        notificationType: params.type,
      }),
    );
    attempts = retryRes.attempts;
    if (retryRes.result) {
      emailResult = retryRes.result;
    } else {
      emailResult = {
        sent: false,
        mode: 'smtp',
        subject: 'CareBridge: Care coordination update',
        recipientMasked: '***',
        reason: retryRes.error,
      };
    }
  }

  markNotificationProcessed(params.dedupeKey);

  return {
    duplicate: false,
    record: {
      dedupeKey: params.dedupeKey,
      groupId: params.groupId,
      type: params.type,
      inAppStatus: 'sent',
      emailResult,
      attempts,
      processedAtIso: new Date().toISOString(),
      timezone: params.timezone,
    },
  };
}
