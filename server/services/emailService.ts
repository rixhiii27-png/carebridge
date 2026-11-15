import nodemailer from 'nodemailer';
import { serverEnv } from '../config/env.ts';

export type EmailDeliveryMode = 'smtp' | 'test';

export interface EmailSendResult {
  sent: boolean;
  mode: EmailDeliveryMode;
  subject: string;
  recipientMasked: string;
  messageId?: string;
  reason?: string;
}

const NEUTRAL_SUBJECT_BY_TYPE: Record<string, string> = {
  upcoming_dose: 'CareBridge: Scheduled care reminder available',
  unconfirmed_dose: 'CareBridge: Care activity update requires review',
  missed_dose: 'CareBridge: Important care update in your group',
  upcoming_appointment: 'CareBridge: Upcoming calendar reminder',
  caregiver_update: 'CareBridge: New update from your care circle',
};

export function maskEmail(email: string): string {
  const parts = email.split('@');
  if (parts.length !== 2) return '***';
  const [local, domain] = parts;
  const visible = local.slice(0, 2);
  return `${visible}***@${domain}`;
}

export function buildPrivacySafeSubject(notificationType: string): string {
  return (
    NEUTRAL_SUBJECT_BY_TYPE[notificationType] ??
    'CareBridge: Sign in to view a new care coordination update'
  );
}

export function buildPrivacySafeEmailBody(appUrl: string): string {
  return [
    'Hello,',
    '',
    'There is a new reminder or care coordination update waiting in your CareBridge account.',
    'For your privacy, protected medication and appointment details are never included in email messages.',
    '',
    `Please sign in securely to review this update: ${appUrl}`,
    '',
    '— CareBridge Care Coordination Platform',
    'Note: CareBridge is a care coordination tool and does not replace professional medical advice.',
  ].join('\n');
}

export async function sendCareNotificationEmail(params: {
  to: string;
  notificationType: string;
}): Promise<EmailSendResult> {
  const subject = buildPrivacySafeSubject(params.notificationType);
  const recipientMasked = maskEmail(params.to);

  if (serverEnv.emailTestMode || !serverEnv.smtp.host) {
    return {
      sent: false,
      mode: 'test',
      subject,
      recipientMasked,
      reason:
        'SMTP provider is not configured (EMAIL_TEST_MODE active). Recorded in delivery log without claiming external transmission.',
    };
  }

  const transporter = nodemailer.createTransport({
    host: serverEnv.smtp.host,
    port: serverEnv.smtp.port,
    secure: serverEnv.smtp.port === 465,
    auth:
      serverEnv.smtp.user && serverEnv.smtp.pass
        ? { user: serverEnv.smtp.user, pass: serverEnv.smtp.pass }
        : undefined,
  });

  const info = await transporter.sendMail({
    from: serverEnv.smtp.from,
    to: params.to,
    subject,
    text: buildPrivacySafeEmailBody(serverEnv.appUrl),
  });

  return {
    sent: true,
    mode: 'smtp',
    subject,
    recipientMasked,
    messageId: info.messageId,
  };
}
