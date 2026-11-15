import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { serverEnv } from '../config/env.ts';

let cachedClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI | null {
  if (!serverEnv.geminiApiKey || serverEnv.geminiApiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  if (!cachedClient) {
    cachedClient = new GoogleGenAI({
      apiKey: serverEnv.geminiApiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return cachedClient;
}

const CARE_ASSISTANT_SYSTEM_INSTRUCTION = `
You are the CareBridge Care Navigation Assistant, a helpful, respectful guide inside an elderly care coordination platform.

STRICT SAFETY BOUNDARIES:
1. You must NEVER diagnose diseases, symptoms, or medical conditions.
2. You must NEVER prescribe medications or recommend starting, stopping, or changing any medication dosage or schedule.
3. You must NEVER present yourself as a doctor, nurse, or certified medical device.
4. If asked for medical advice, diagnosis, or dosage changes, politely decline and advise the user to consult their prescribing physician or local healthcare professional.
5. You MAY explain how to use CareBridge modules (Medications, Appointments, Family & Caregivers, Notifications, Accessibility, Languages), explain status labels ("Not confirmed" means neither taken nor skipped has been logged yet), and summarize the user-provided care context clearly.
6. Keep answers concise, warm, plain-spoken, and easy for elderly users and caregivers to read.
`.trim();

export async function askCareAssistant(params: {
  question: string;
  languageName: string;
  careContext?: {
    elderlyName?: string;
    activeMedicationsCount?: number;
    upcomingAppointmentsCount?: number;
    todaySummary?: string;
  };
}): Promise<{ answer: string; poweredByModel: boolean }> {
  const ai = getGeminiClient();
  if (!ai) {
    return {
      poweredByModel: false,
      answer:
        'CareBridge Assistant can help you navigate Medications, Appointments, Family & Caregivers, and Accessibility settings. Note: "Not confirmed" means a scheduled dose has not yet been marked Taken or Skipped. For medical or dosage questions, please contact your prescribing clinician.',
    };
  }

  const contextLines = params.careContext
    ? [
        params.careContext.elderlyName ? `Care profile: ${params.careContext.elderlyName}` : '',
        typeof params.careContext.activeMedicationsCount === 'number'
          ? `Active medications listed: ${params.careContext.activeMedicationsCount}`
          : '',
        typeof params.careContext.upcomingAppointmentsCount === 'number'
          ? `Upcoming appointments listed: ${params.careContext.upcomingAppointmentsCount}`
          : '',
        params.careContext.todaySummary ? `Today summary: ${params.careContext.todaySummary}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    : 'No care summary attached.';

  const prompt = [
    `Respond in ${params.languageName} using clear, respectful wording.`,
    `Context:\n${contextLines}`,
    `User question: ${params.question}`,
  ].join('\n\n');

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      systemInstruction: CARE_ASSISTANT_SYSTEM_INSTRUCTION,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    },
  });

  return {
    poweredByModel: true,
    answer:
      response.text?.trim() ||
      'I could not generate a response right now. Please check the Dashboard or contact your physician for clinical guidance.',
  };
}

export async function translateCareInterfaceLabel(params: {
  text: string;
  targetLanguage: string;
  isMedicationName: boolean;
}): Promise<{ translatedText: string; machineTranslated: boolean }> {
  if (params.isMedicationName) {
    return { translatedText: params.text, machineTranslated: false };
  }

  const ai = getGeminiClient();
  if (!ai) {
    return { translatedText: params.text, machineTranslated: false };
  }

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `Translate the following elderly healthcare coordination interface note accurately into ${params.targetLanguage}. Preserve numbers, times, and proper names verbatim. Do not alter any medical instructions or dosages. Return only the translated text.\n\nText: ${params.text}`,
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    },
  });

  return {
    translatedText: response.text?.trim() || params.text,
    machineTranslated: true,
  };
}
