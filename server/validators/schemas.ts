import { z } from 'zod';

export const dispatchNotificationSchema = z.object({
  groupId: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  type: z.enum([
    'upcoming_dose',
    'unconfirmed_dose',
    'missed_dose',
    'upcoming_appointment',
    'caregiver_update',
  ]),
  title: z.string().min(1).max(140),
  message: z.string().min(1).max(500),
  dedupeKey: z.string().min(1).max(180),
  sendEmail: z.boolean().default(false),
  recipientEmail: z.string().email().max(254).optional(),
  timezone: z.string().min(1).max(64).default('Asia/Kolkata'),
});

export const careAssistantSchema = z.object({
  question: z.string().min(2).max(600),
  languageName: z.string().min(2).max(48).default('English'),
  careContext: z.object({
    elderlyName: z.string().max(120).optional(),
    activeMedicationsCount: z.number().int().min(0).max(100).optional(),
    upcomingAppointmentsCount: z.number().int().min(0).max(100).optional(),
    todaySummary: z.string().max(800).optional(),
  }).optional(),
});

export const translateLabelSchema = z.object({
  text: z.string().min(1).max(500),
  targetLanguage: z.string().min(2).max(48),
  isMedicationName: z.boolean().default(false),
});

export const schedulerTriggerSchema = z.object({
  dryRun: z.boolean().default(false),
  timezone: z.string().min(1).max(64).default('Asia/Kolkata'),
});
