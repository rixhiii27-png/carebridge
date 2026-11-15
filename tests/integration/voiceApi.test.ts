import http from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../server.ts';
import { setBackendOverridesForTests } from '../../server/config/backendContext.ts';
import { setAuthVerifiersForTests } from '../../server/middleware/auth.ts';
import { InMemoryFirestore } from '../helpers/inMemoryFirestore.ts';

describe('/api/v1/voice Multilingual Voice Integration Tests', () => {
  let server: http.Server;
  let baseUrl: string;
  let memDb: InMemoryFirestore;
  let groupId: string;
  let medId: string;

  const TOKENS: Record<string, { uid: string; email: string; email_verified: boolean; name: string }> = {
    'tok-elder': { uid: 'elder_uid', email: 'elder@carebridge.local', email_verified: true, name: 'Raghavan' },
    'tok-cg': { uid: 'cg_uid', email: 'caregiver@carebridge.local', email_verified: true, name: 'Meera' },
    'tok-outsider': { uid: 'outsider_uid', email: 'outsider@carebridge.local', email_verified: true, name: 'Outsider' },
  };

  beforeAll(async () => {
    const app = createApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      throw new Error('Failed to bind ephemeral port');
    }
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  beforeEach(async () => {
    memDb = new InMemoryFirestore();
    setBackendOverridesForTests({
      db: memDb.asFirestore(),
      auth: {
        revokeRefreshTokens: async () => undefined,
      } as unknown as import('firebase-admin/auth').Auth,
    });
    setAuthVerifiersForTests({
      tokenVerifier: async (token) => {
        const claims = TOKENS[token];
        if (!claims) throw new Error('Invalid token');
        return claims;
      },
    });

    await memDb.doc('users/elder_uid').set({
      uid: 'elder_uid',
      displayName: 'Raghavan',
      role: 'elderly',
      preferredLanguage: 'en',
      preferredScript: 'Latin',
      timezone: 'Asia/Kolkata',
    });
    await memDb.doc('users/cg_uid').set({
      uid: 'cg_uid',
      displayName: 'Meera',
      role: 'caregiver',
      preferredLanguage: 'hi',
      preferredScript: 'Devanagari',
      timezone: 'Asia/Kolkata',
    });

    // Create group, member, medication & appointment
    const grpRes = await fetch(`${baseUrl}/api/v1/care-groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-elder' },
      body: JSON.stringify({
        elderlyName: 'Shri Raghavan',
        elderlyAge: 76,
        ownerRole: 'elderly',
        primaryPhysician: 'Dr. Ananya Nair',
        primaryClinic: 'Bengaluru Care Clinic',
        timezone: 'Asia/Kolkata',
      }),
    });
    const grpJson = (await grpRes.json()) as { group: { id: string } };
    groupId = grpJson.group.id;

    // Add caregiver as active member directly in test db
    await memDb.doc(`careGroups/${groupId}`).update({ memberUids: ['elder_uid', 'cg_uid'] });
    await memDb.doc(`careGroups/${groupId}/members/cg_uid`).set({
      uid: 'cg_uid',
      groupId,
      displayName: 'Meera',
      role: 'caregiver',
      canEditMedications: false,
      canEditAppointments: false,
      status: 'active',
    });

    const medRes = await fetch(`${baseUrl}/api/v1/medications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-elder' },
      body: JSON.stringify({
        groupId,
        name: 'Metformin',
        dosage: '500 mg',
        scheduleTimes: ['08:00', '20:00'],
        frequency: 'twice_daily',
        startDate: '2026-01-01',
      }),
    });
    const medJson = (await medRes.json()) as { medication: { id: string } };
    medId = medJson.medication.id;

    await fetch(`${baseUrl}/api/v1/appointments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-elder' },
      body: JSON.stringify({
        groupId,
        doctorName: 'Dr. Ananya Nair',
        clinicName: 'Bengaluru Care Clinic',
        appointmentDate: '2099-12-15',
        appointmentTime: '10:30',
        timezone: 'Asia/Kolkata',
        reminderMinutesBefore: 60,
      }),
    });
  });

  afterAll(async () => {
    setBackendOverridesForTests({ db: null, auth: null });
    setAuthVerifiersForTests({ tokenVerifier: null, oidcVerifier: null });
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('rejects unauthenticated requests with 401 and cross-group outsiders with 403', async () => {
    const unauth = await fetch(`${baseUrl}/api/v1/voice/capabilities`);
    expect(unauth.status).toBe(401);

    const outsider = await fetch(`${baseUrl}/api/v1/voice/converse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-outsider' },
      body: JSON.stringify({
        transcript: 'Show my medicines',
        preferredLanguage: 'en',
        groupId,
      }),
    });
    expect(outsider.status).toBe(403);
  });

  it('returns the complete 23-language capability matrix and zero-audio-retention metadata', async () => {
    const res = await fetch(`${baseUrl}/api/v1/voice/capabilities`, {
      headers: { Authorization: 'Bearer tok-elder' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      zeroAudioRetention: boolean;
      languagesCount: number;
      languages: Array<{ code: string; neuralServerSupport: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.zeroAudioRetention).toBe(true);
    expect(body.languagesCount).toBe(23);
    expect(body.languages.find((l) => l.code === 'brx')?.neuralServerSupport).toBe('experimental');
  });

  it('handles English, Hindi, and Kannada schedule/appointment voice queries in native scripts', async () => {
    // 1. English next medicine
    const enNext = await fetch(`${baseUrl}/api/v1/voice/converse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-elder' },
      body: JSON.stringify({
        transcript: 'Which medicine should I take next?',
        preferredLanguage: 'en',
        groupId,
      }),
    });
    expect(enNext.status).toBe(200);
    const enBody = (await enNext.json()) as { replyText: string; intent: string; navigateTo: string };
    expect(enBody.intent).toBe('query_next_dose');
    expect(enBody.replyText).toContain('Metformin');
    expect(enBody.replyText).toContain('500 mg');
    expect(enBody.navigateTo).toBe('/medications');

    // 2. Kannada native script response preserved verbatim
    const knRes = await fetch(`${baseUrl}/api/v1/voice/converse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-elder' },
      body: JSON.stringify({
        transcript: 'ನನ್ನ ಮುಂದಿನ ಔಷಧಿ ಯಾವುದು?',
        preferredLanguage: 'kn',
        autoDetectLanguage: true,
        groupId,
      }),
    });
    expect(knRes.status).toBe(200);
    const knBody = (await knRes.json()) as {
      replyText: string;
      responseLanguageCode: string;
      responseBcp47: string;
    };
    expect(knBody.responseLanguageCode).toBe('kn');
    expect(knBody.responseBcp47).toBe('kn-IN');
    expect(knBody.replyText).toMatch(/[\u0C80-\u0CFF]/);
    expect(knBody.replyText).toContain('Metformin');

    // 3. Hindi appointment query preserved in Devanagari
    const hiRes = await fetch(`${baseUrl}/api/v1/voice/converse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-elder' },
      body: JSON.stringify({
        transcript: 'मेरा अगला डॉक्टर अपॉइंटमेंट दिखाओ',
        preferredLanguage: 'hi',
        autoDetectLanguage: true,
        groupId,
      }),
    });
    expect(hiRes.status).toBe(200);
    const hiBody = (await hiRes.json()) as {
      replyText: string;
      responseLanguageCode: string;
      intent: string;
      navigateTo: string;
    };
    expect(hiBody.responseLanguageCode).toBe('hi');
    expect(hiBody.intent).toBe('query_appointments');
    expect(hiBody.navigateTo).toBe('/appointments');
    expect(hiBody.replyText).toMatch(/[\u0900-\u097F]/);
    expect(hiBody.replyText).toContain('Dr. Ananya Nair');
  });

  it('enforces medical boundaries and urgent emergency referral', async () => {
    const boundaryRes = await fetch(`${baseUrl}/api/v1/voice/converse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-elder' },
      body: JSON.stringify({
        transcript: 'Should I double dose or stop taking Metformin?',
        preferredLanguage: 'en',
        groupId,
      }),
    });
    const boundaryBody = (await boundaryRes.json()) as { intent: string; replyText: string };
    expect(boundaryBody.intent).toBe('medical_boundary');
    expect(boundaryBody.replyText).toContain('Dr. Ananya Nair');

    const emergencyRes = await fetch(`${baseUrl}/api/v1/voice/converse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-elder' },
      body: JSON.stringify({
        transcript: 'I am having severe chest pain',
        preferredLanguage: 'en',
        groupId,
      }),
    });
    const emergencyBody = (await emergencyRes.json()) as {
      intent: string;
      emergencyNotice: boolean;
      replyText: string;
    };
    expect(emergencyBody.intent).toBe('emergency');
    expect(emergencyBody.emergencyNotice).toBe(true);
    expect(emergencyBody.replyText).toMatch(/112|108|emergency/i);
  });

  it('requires explicit confirmation before changing preferred language or alerting caregivers', async () => {
    // 1. Ask to change preferred language to Kannada
    const langAsk = await fetch(`${baseUrl}/api/v1/voice/converse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-elder' },
      body: JSON.stringify({
        transcript: 'Change my preferred language to Kannada',
        preferredLanguage: 'en',
        groupId,
      }),
    });
    const langAskBody = (await langAsk.json()) as {
      requiresConfirmation: boolean;
      pendingAction: { actionType: string; payload: { targetLanguageCode: string; targetScript: string } };
    };
    expect(langAskBody.requiresConfirmation).toBe(true);
    expect(langAskBody.pendingAction.actionType).toBe('change_language');
    expect(langAskBody.pendingAction.payload.targetLanguageCode).toBe('kn');

    // Attempt without confirmed: true must fail with 400
    const unconfirmed = await fetch(`${baseUrl}/api/v1/voice/execute-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-elder' },
      body: JSON.stringify({
        confirmed: false,
        actionType: 'change_language',
        payload: langAskBody.pendingAction.payload,
      }),
    });
    expect(unconfirmed.status).toBe(400);

    // Execute with confirmed: true updates Firestore profile
    const confirmedLang = await fetch(`${baseUrl}/api/v1/voice/execute-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-elder' },
      body: JSON.stringify({
        confirmed: true,
        actionType: 'change_language',
        payload: langAskBody.pendingAction.payload,
      }),
    });
    expect(confirmedLang.status).toBe(200);
    const elderSnap = await memDb.doc('users/elder_uid').get();
    expect((elderSnap.data() as { preferredLanguage: string }).preferredLanguage).toBe('kn');

    // 2. Ask to tell caregiver about missed reminder -> execute -> creates localized notification
    const alertAsk = await fetch(`${baseUrl}/api/v1/voice/converse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-elder' },
      body: JSON.stringify({
        transcript: 'Tell my caregiver about my missed reminder',
        preferredLanguage: 'en',
        groupId,
      }),
    });
    const alertAskBody = (await alertAsk.json()) as {
      requiresConfirmation: boolean;
      pendingAction: { actionType: string; payload: Record<string, unknown> };
    };
    expect(alertAskBody.requiresConfirmation).toBe(true);
    expect(alertAskBody.pendingAction.actionType).toBe('notify_caregiver_missed');

    const alertExec = await fetch(`${baseUrl}/api/v1/voice/execute-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-elder' },
      body: JSON.stringify({
        confirmed: true,
        actionType: 'notify_caregiver_missed',
        groupId,
        payload: alertAskBody.pendingAction.payload,
      }),
    });
    expect(alertExec.status).toBe(200);
    const execJson = (await alertExec.json()) as { notificationsSent: number };
    expect(execJson.notificationsSent).toBe(1);

    const cgNotifications = await memDb.collection('notifications').where('recipientUid', '==', 'cg_uid').get();
    expect(cgNotifications.docs).toHaveLength(1);
    const notifData = cgNotifications.docs[0].data() as { title: string; type: string };
    expect(notifData.type).toBe('missed_dose');
    // Caregiver preferredLanguage is 'hi', so notification is in Devanagari!
    expect(notifData.title).toMatch(/[\u0900-\u097F]/);

    // 3. Log dose confirmed action works cleanly too
    const todayKey = new Date().toISOString().slice(0, 10);
    const doseExec = await fetch(`${baseUrl}/api/v1/voice/execute-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-elder' },
      body: JSON.stringify({
        confirmed: true,
        actionType: 'log_dose',
        groupId,
        payload: {
          medicationId: medId,
          scheduledDate: todayKey,
          scheduledTime: '08:00',
          status: 'taken',
        },
      }),
    });
    expect(doseExec.status).toBe(200);
  });

  it('honestly reports TTS fallback when experimental language or unconfigured GEMINI_API_KEY', async () => {
    const expRes = await fetch(`${baseUrl}/api/v1/voice/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-elder' },
      body: JSON.stringify({
        text: 'बड़ो भाषा',
        languageCode: 'brx',
        speakingRate: 0.95,
      }),
    });
    expect(expRes.status).toBe(200);
    const expBody = (await expRes.json()) as {
      audioAvailable: boolean;
      fallbackToBrowserTts: boolean;
      reason: string;
    };
    expect(expBody.audioAvailable).toBe(false);
    expect(expBody.fallbackToBrowserTts).toBe(true);
    expect(expBody.reason).toContain('experimental');

    const capRes = await fetch(`${baseUrl}/api/v1/voice/capabilities`, {
      headers: { Authorization: 'Bearer tok-elder' },
    });
    const capBody = (await capRes.json()) as {
      ttsProviders: string[];
      neuralConfigured: boolean;
      googleCloudTtsConfigured: boolean;
    };
    expect(Array.isArray(capBody.ttsProviders)).toBe(true);
    expect(capBody.ttsProviders).toContain('browser-speech-synthesis');
  });

  it('synthesizes real MP3 audio via secondary Google Cloud TTS provider across en, kn, and hi when configured', async () => {
    const { serverEnv } = await import('../../server/config/env.ts');
    const prevKey = serverEnv.googleCloudTtsApiKey;
    const realFetch = globalThis.fetch;
    const fakeMp3Base64 = Buffer.alloc(256, 0xab).toString('base64');

    try {
      (serverEnv as { googleCloudTtsApiKey: string }).googleCloudTtsApiKey = 'test-cloud-tts-key';

      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.startsWith('https://texttospeech.googleapis.com/v1/text:synthesize')) {
          return new Response(JSON.stringify({ audioContent: fakeMp3Base64 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return realFetch(input, init);
      }) as typeof fetch;

      for (const [langCode, sampleText, expectedBcp] of [
        ['en', 'Your next medicine is Metformin.', 'en-IN'],
        ['kn', 'ನಿಮ್ಮ ಮುಂದಿನ ಔಷಧಿ ಮೆಟ್‌ಫಾರ್ಮಿನ್.', 'kn-IN'],
        ['hi', 'आपकी अगली दवा मेटफॉर्मिन है।', 'hi-IN'],
      ] as const) {
        const res = await realFetch(`${baseUrl}/api/v1/voice/synthesize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-elder' },
          body: JSON.stringify({
            text: sampleText,
            languageCode: langCode,
            speakingRate: 0.95,
          }),
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          ok: boolean;
          audioAvailable: boolean;
          provider: string;
          mimeType: string;
          byteLength: number;
          bcp47: string;
          audioBase64: string;
        };
        expect(body.ok).toBe(true);
        expect(body.audioAvailable).toBe(true);
        expect(body.provider).toBe('google-cloud-tts');
        expect(body.mimeType).toBe('audio/mpeg');
        expect(body.byteLength).toBe(256);
        expect(body.bcp47).toBe(expectedBcp);
        expect(body.audioBase64).toBe(fakeMp3Base64);
      }
    } finally {
      (serverEnv as { googleCloudTtsApiKey: string }).googleCloudTtsApiKey = prevKey;
      globalThis.fetch = realFetch;
    }
  });
});
