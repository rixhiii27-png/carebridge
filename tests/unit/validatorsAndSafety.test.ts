import { describe, expect, it } from 'vitest';
import {
  careAssistantSchema,
  dispatchNotificationSchema,
  schedulerTriggerSchema,
  translateLabelSchema,
} from '../../server/validators/schemas.ts';
import {
  askCareAssistant,
  translateCareInterfaceLabel,
} from '../../server/services/geminiCareAssistant.ts';

describe('Zod Validators & Care Safety Guardrails', () => {
  it('validates notification dispatch payloads and rejects malformed group IDs', () => {
    const valid = dispatchNotificationSchema.safeParse({
      groupId: 'grp_family_01',
      type: 'upcoming_dose',
      title: 'Morning schedule',
      message: 'Please review today schedule.',
      dedupeKey: 'grp_family_01_2026-04-15',
      sendEmail: true,
      recipientEmail: 'family@example.com',
      timezone: 'Asia/Kolkata',
    });
    expect(valid.success).toBe(true);

    const poisoned = dispatchNotificationSchema.safeParse({
      groupId: '../../etc/passwd',
      type: 'upcoming_dose',
      title: 'Bad',
      message: 'Bad',
      dedupeKey: 'x',
    });
    expect(poisoned.success).toBe(false);
  });

  it('validates assistant, translation, and scheduler schemas', () => {
    expect(
      careAssistantSchema.safeParse({
        question: 'What does Not confirmed mean?',
        languageName: 'Hindi',
      }).success,
    ).toBe(true);

    expect(
      careAssistantSchema.safeParse({
        question: 'x',
      }).success,
    ).toBe(false);

    expect(
      translateLabelSchema.safeParse({
        text: 'Take after breakfast.',
        targetLanguage: 'Tamil',
        isMedicationName: false,
      }).success,
    ).toBe(true);

    expect(schedulerTriggerSchema.safeParse({ dryRun: true }).success).toBe(true);
  });

  it('never translates medication brand names when isMedicationName=true', async () => {
    const result = await translateCareInterfaceLabel({
      text: 'Metformin 500mg',
      targetLanguage: 'Hindi',
      isMedicationName: true,
    });

    expect(result.translatedText).toBe('Metformin 500mg');
    expect(result.machineTranslated).toBe(false);
  });

  it('returns safe non-diagnostic fallback guidance when Gemini key is unset', async () => {
    const res = await askCareAssistant({
      question: 'How do I log a dose?',
      languageName: 'English',
    });

    expect(res.answer).toContain('Not confirmed');
    expect(res.answer).toContain('prescribing clinician');
    expect(res.answer.toLowerCase()).not.toContain('diagnose');
  });
});
