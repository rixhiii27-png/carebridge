import type { Request, Response } from 'express';
import { getBackendDb } from '../config/backendContext.ts';
import { serverEnv } from '../config/env.ts';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { processSchedulerSweep } from '../modules/notifications/notificationsModule.ts';
import { askCareAssistant, translateCareInterfaceLabel } from '../services/geminiCareAssistant.ts';
import { isActiveGroupMemberAdmin } from '../services/firestoreAdmin.ts';
import {
  dispatchNotificationWithGuards,
  formatTimezoneDateKey,
} from '../services/notificationEngine.ts';
import {
  careAssistantSchema,
  dispatchNotificationSchema,
  schedulerTriggerSchema,
  translateLabelSchema,
} from '../validators/schemas.ts';

export function getHealthStatus(_req: Request, res: Response): void {
  res.status(200).json({
    ok: true,
    service: 'carebridge-api',
    environment: serverEnv.nodeEnv,
    emailMode: serverEnv.emailTestMode ? 'test' : 'smtp',
    timestamp: new Date().toISOString(),
  });
}

export async function handleDispatchNotification(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const parsed = dispatchNotificationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      error: 'Invalid notification dispatch payload.',
      details: parsed.error.flatten(),
    });
    return;
  }

  if (!req.user?.uid) {
    res.status(401).json({ ok: false, error: 'Authentication required.' });
    return;
  }

  try {
    const isMember = await isActiveGroupMemberAdmin(parsed.data.groupId, req.user.uid);
    if (!isMember) {
      res.status(403).json({
        ok: false,
        error: 'Forbidden: you are not an active member of this care group.',
      });
      return;
    }

    // Never allow arbitrary third-party email relay; deliver only to authenticated user's verified email
    const verifiedRecipient = req.user.email;
    const shouldSendEmail = parsed.data.sendEmail && Boolean(verifiedRecipient);

    const result = await dispatchNotificationWithGuards({
      groupId: parsed.data.groupId,
      type: parsed.data.type,
      dedupeKey: parsed.data.dedupeKey,
      sendEmail: shouldSendEmail,
      recipientEmail: verifiedRecipient,
      timezone: parsed.data.timezone,
    });

    res.status(200).json({
      ok: true,
      duplicatePrevented: result.duplicate,
      dispatch: result.record,
    });
  } catch (err) {
    console.error('Notification dispatch failed:', err instanceof Error ? err.message : err);
    res.status(500).json({ ok: false, error: 'Failed to process notification dispatch.' });
  }
}

export async function handleSchedulerSweep(req: Request, res: Response): Promise<void> {
  const parsed = schedulerTriggerSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'Invalid scheduler payload.' });
    return;
  }

  const todayKey = formatTimezoneDateKey(new Date(), parsed.data.timezone);
  try {
    const summary = await processSchedulerSweep(
      {
        dryRun: parsed.data.dryRun,
        timezoneOverride:
          typeof req.body?.timezone === 'string' ? parsed.data.timezone : undefined,
      },
      getBackendDb(),
    );

    res.status(200).json({
      ok: true,
      sweepDateKey: todayKey,
      timezone: parsed.data.timezone,
      dryRun: parsed.data.dryRun,
      processedAt: summary.processedAtIso,
      summary,
    });
  } catch (err) {
    console.error('Scheduler sweep error:', err instanceof Error ? err.message : err);
    res.status(500).json({ ok: false, error: 'Scheduler notification sweep failed.' });
  }
}

export async function handleCareAssistant(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const parsed = careAssistantSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      error: 'Invalid assistant request.',
      details: parsed.error.flatten(),
    });
    return;
  }

  try {
    const result = await askCareAssistant(parsed.data);
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('Care assistant error:', err instanceof Error ? err.message : err);
    res.status(500).json({
      ok: false,
      error: 'Care Assistant is temporarily unavailable.',
    });
  }
}

export async function handleTranslateNote(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const parsed = translateLabelSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'Invalid translation payload.' });
    return;
  }

  try {
    const result = await translateCareInterfaceLabel(parsed.data);
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('Translation error:', err instanceof Error ? err.message : err);
    res.status(500).json({ ok: false, error: 'Translation failed.' });
  }
}
