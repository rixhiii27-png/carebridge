import { z } from 'zod';

const idRegex = /^[a-zA-Z0-9_-]{1,128}$/;

export const transcribeAudioSchema = z
  .object({
    audioBase64: z.string().min(16).max(3_600_000),
    mimeType: z.enum([
      'audio/webm',
      'audio/mp4',
      'audio/ogg',
      'audio/wav',
      'audio/mpeg',
    ]),
    preferredLanguage: z.string().trim().min(2).max(16).default('en'),
    autoDetect: z.boolean().default(true),
  })
  .strict();

export const voiceConverseSchema = z
  .object({
    transcript: z.string().trim().min(1, 'Transcript cannot be empty.').max(800),
    preferredLanguage: z.string().trim().min(2).max(16).default('en'),
    autoDetectLanguage: z.boolean().default(true),
    groupId: z.string().regex(idRegex, 'Invalid groupId').optional(),
    history: z
      .array(
        z
          .object({
            role: z.enum(['user', 'assistant']),
            text: z.string().trim().min(1).max(600),
          })
          .strict(),
      )
      .max(8)
      .default([]),
  })
  .strict();

export const voiceExecuteActionSchema = z
  .object({
    confirmed: z.literal(true),
    actionType: z.enum(['log_dose', 'notify_caregiver_missed', 'change_language']),
    groupId: z.string().regex(idRegex, 'Invalid groupId').optional(),
    payload: z
      .object({
        medicationId: z.string().regex(idRegex).optional(),
        medicationName: z.string().trim().min(1).max(120).optional(),
        scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        scheduledTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        status: z.enum(['taken', 'skipped', 'missed', 'not_confirmed']).optional(),
        note: z.string().trim().max(300).optional(),
        targetLanguageCode: z.string().trim().min(2).max(16).optional(),
        targetScript: z.string().trim().min(1).max(32).optional(),
      })
      .strict(),
  })
  .strict();

export const voiceSynthesizeSchema = z
  .object({
    text: z.string().trim().min(1).max(2400),
    languageCode: z.string().trim().min(2).max(16).default('en'),
    speakingRate: z.number().min(0.7).max(1.3).default(0.95),
  })
  .strict();
