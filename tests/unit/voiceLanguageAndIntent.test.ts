import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  detectScriptLanguageHint,
  findLanguageSwitchTarget,
  getVoiceLanguageCapability,
  VOICE_LANGUAGE_MATRIX,
} from '../../shared/voiceLanguageMatrix.ts';
import { SUPPORTED_LANGUAGES } from '../../src/i18n/languages.ts';
import {
  transcribeAudioSchema,
  voiceConverseSchema,
  voiceExecuteActionSchema,
  voiceSynthesizeSchema,
} from '../../server/validators/voiceSchemas.ts';
import {
  startVoiceListening,
  stopActiveListening,
} from '../../src/services/voiceService.ts';

describe('CareBridge 23-Language Voice Matrix & Validators', () => {
  afterEach(() => {
    stopActiveListening();
    vi.unstubAllGlobals();
  });

  it('covers all 23 CareBridge languages honestly with accurate BCP-47, RTL scripts, and non-exaggerated capability tiers', () => {
    expect(VOICE_LANGUAGE_MATRIX).toHaveLength(23);
    const matrixCodes = VOICE_LANGUAGE_MATRIX.map((l) => l.code).sort();
    const uiCodes = SUPPORTED_LANGUAGES.map((l) => l.code).sort();
    expect(matrixCodes).toEqual(uiCodes);

    expect(getVoiceLanguageCapability('ur').defaultDir).toBe('rtl');
    expect(getVoiceLanguageCapability('ks').defaultDir).toBe('rtl');
    expect(getVoiceLanguageCapability('sd').defaultDir).toBe('rtl');
    expect(getVoiceLanguageCapability('kn').bcp47).toBe('kn-IN');
    expect(getVoiceLanguageCapability('hi').bcp47).toBe('hi-IN');

    // Low-resource / minority languages are honestly flagged experimental, not natively claimed
    for (const code of ['brx', 'mni', 'sat']) {
      const cap = getVoiceLanguageCapability(code);
      expect(cap.recognitionTier).toBe('experimental_text_fallback');
      expect(cap.synthesisTier).toBe('experimental_text_fallback');
      expect(cap.browserSttExpected).toBe(false);
    }

    // Regional neural-primary languages never falsely claim browser Web Speech
    for (const code of ['or', 'as', 'kok', 'mai', 'doi', 'sa', 'ks', 'sd']) {
      const cap = getVoiceLanguageCapability(code);
      expect(cap.browserSttExpected).toBe(false);
    }
  });

  it('detects native scripts without silently flattening regional speech into English', () => {
    expect(detectScriptLanguageHint('ನನ್ನ ಮುಂದಿನ ಔಷಧಿ ಯಾವುದು?')).toBe('kn');
    expect(detectScriptLanguageHint('मेरी अगली दवा कौन सी है?')).toBe('hi');
    expect(detectScriptLanguageHint('என் அடுத்த மருந்து எது?')).toBe('ta');
    expect(detectScriptLanguageHint('నా తదుపరి మందు ఏది?')).toBe('te');
    expect(detectScriptLanguageHint('میری اگلی دوا کون سی ہے؟')).toBe('ur');
    expect(detectScriptLanguageHint('Which medicine should I take next?')).toBeNull();
  });

  it('parses multilingual language-switch commands accurately', () => {
    const kn = findLanguageSwitchTarget('Change my preferred language to Kannada');
    expect(kn?.code).toBe('kn');

    const hi = findLanguageSwitchTarget('Please switch language to Hindi');
    expect(hi?.code).toBe('hi');

    const nonSwitch = findLanguageSwitchTarget('Show my upcoming appointments');
    expect(nonSwitch).toBeNull();
  });

  it('enforces strict Zod validation including confirmed === true on sensitive voice mutations', () => {
    expect(() =>
      voiceConverseSchema.parse({
        transcript: '   ',
        preferredLanguage: 'en',
      }),
    ).toThrow();

    expect(() =>
      voiceExecuteActionSchema.parse({
        confirmed: false,
        actionType: 'notify_caregiver_missed',
        groupId: 'grp_123',
        payload: { medicationName: 'Metformin' },
      }),
    ).toThrow();

    const validAction = voiceExecuteActionSchema.parse({
      confirmed: true,
      actionType: 'change_language',
      payload: { targetLanguageCode: 'kn', targetScript: 'Kannada' },
    });
    expect(validAction.confirmed).toBe(true);

    expect(() =>
      transcribeAudioSchema.parse({
        audioBase64: 'short',
        mimeType: 'audio/webm',
      }),
    ).toThrow();

    expect(() =>
      voiceSynthesizeSchema.parse({
        text: 'Hello',
        languageCode: 'kn',
        speakingRate: 2.5,
      }),
    ).toThrow();
  });

  it('prevents concurrent microphone sessions and reports permission denial cleanly', async () => {
    const errors: Array<{ code: string; msg: string }> = [];
    const getUserMediaDenied = vi.fn().mockRejectedValue(
      new DOMException('Permission denied', 'NotAllowedError'),
    );

    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
      },
      speechSynthesis: {
        getVoices: () => [],
        cancel: () => {},
      },
      SpeechSynthesisUtterance: function () {},
    });
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: getUserMediaDenied },
    });

    await new Promise<void>((resolve) => {
      startVoiceListening({
        languageCode: 'en',
        onFinalTranscript: () => {},
        onError: (code, msg) => {
          errors.push({ code, msg });
          resolve();
        },
      });
    });

    expect(errors[0]?.code).toBe('PERMISSION_DENIED');

    // Now test concurrent lock while active session holds microphone stream
    const mockStop = vi.fn();
    let resolveMic!: (stream: unknown) => void;
    const pendingMic = new Promise((r) => {
      resolveMic = r;
    });
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: () => pendingMic },
    });

    startVoiceListening({
      languageCode: 'en',
      onFinalTranscript: () => {},
      onError: () => {},
    });

    const lockErrors: string[] = [];
    startVoiceListening({
      languageCode: 'en',
      onFinalTranscript: () => {},
      onError: (code) => lockErrors.push(code),
    });

    expect(lockErrors).toEqual(['SESSION_ALREADY_ACTIVE']);
    stopActiveListening();
    resolveMic({ getTracks: () => [{ stop: mockStop }] });
  });
});
