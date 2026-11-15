import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetToken = vi.fn<() => Promise<string | null>>();

vi.mock('../../src/services/firestoreService.ts', () => ({
  getAuthenticatedIdToken: () => mockGetToken(),
}));

import { ensureValidWavBase64 } from '../../server/modules/voice/voiceService.ts';
import {
  createAudioBlobFromBase64,
  detectVoiceCapabilities,
  getBrowserVoiceInventorySummary,
  pickBestBrowserVoice,
  playCachedAudioBuffer,
  speakTextWithFallback,
  splitTextForSpeech,
  startVoiceListening,
  stopActiveListening,
  stopAllVoicePlayback,
  unlockMobileAudioPlayback,
  waitForSpeechSynthesisVoices,
} from '../../src/services/voiceService.ts';
import { voiceSynthesizeSchema } from '../../server/validators/voiceSchemas.ts';

function createValidWavBase64(pcmBytes = 64): string {
  const header = Buffer.alloc(44 + pcmBytes);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcmBytes, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24);
  header.writeUInt32LE(48000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcmBytes, 40);
  return header.toString('base64');
}

function makeFakeVoice(name: string, lang: string): SpeechSynthesisVoice {
  return {
    name,
    lang,
    default: false,
    localService: true,
    voiceURI: `${name}://${lang}`,
  } as SpeechSynthesisVoice;
}

describe('CareBridge Multilingual Audio Synthesis & Playback Suite (TEST 1–TEST 11)', () => {
  let createdUrls: string[];
  let revokedUrls: string[];
  let createdAudioInstances: Array<{
    src: string;
    playbackRate: number;
    preload: string;
    attributes: Record<string, string>;
    onended: (() => void) | null;
    onerror: (() => void) | null;
    pause: ReturnType<typeof vi.fn>;
    play: ReturnType<typeof vi.fn>;
    load: ReturnType<typeof vi.fn>;
    setAttribute: (k: string, v: string) => void;
    removeAttribute: (k: string) => void;
  }>;
  let synthVoices: SpeechSynthesisVoice[];
  let voicesChangedListeners: Set<() => void>;
  let speakBehavior: 'auto_complete' | 'hang' | 'error' | 'not_allowed';
  let spokenUtterances: Array<{ text: string; lang: string; voice?: SpeechSynthesisVoice | null; rate: number }>;
  let synthCancelSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createdUrls = [];
    revokedUrls = [];
    createdAudioInstances = [];
    synthVoices = [];
    voicesChangedListeners = new Set();
    speakBehavior = 'auto_complete';
    spokenUtterances = [];
    synthCancelSpy = vi.fn();
    mockGetToken.mockResolvedValue('test-firebase-id-token');

    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => {
        const url = `blob:carebridge-test-${createdUrls.length + 1}`;
        createdUrls.push(url);
        return url;
      }),
      revokeObjectURL: vi.fn((url: string) => {
        revokedUrls.push(url);
      }),
    });

    class MockAudio {
      src = '';
      playbackRate = 1;
      preload = '';
      attributes: Record<string, string> = {};
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      pause = vi.fn();
      load = vi.fn();
      play = vi.fn().mockImplementation(async () => {
        queueMicrotask(() => {
          this.onended?.();
        });
      });
      setAttribute(k: string, v: string) {
        this.attributes[k] = v;
      }
      removeAttribute(k: string) {
        delete this.attributes[k];
      }
      constructor() {
        createdAudioInstances.push(this);
      }
    }
    vi.stubGlobal('Audio', MockAudio);

    class MockUtterance {
      text: string;
      lang = '';
      voice: SpeechSynthesisVoice | null = null;
      rate = 1;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((ev?: { error?: string }) => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    }
    vi.stubGlobal('SpeechSynthesisUtterance', MockUtterance);

    const mockSpeechSynthesis = {
      paused: false,
      getVoices: () => synthVoices,
      cancel: synthCancelSpy,
      resume: vi.fn(),
      addEventListener: (_evt: string, cb: () => void) => {
        voicesChangedListeners.add(cb);
      },
      removeEventListener: (_evt: string, cb: () => void) => {
        voicesChangedListeners.delete(cb);
      },
      speak: vi.fn((utt: MockUtterance) => {
        spokenUtterances.push({
          text: utt.text,
          lang: utt.lang,
          voice: utt.voice,
          rate: utt.rate,
        });
        if (speakBehavior === 'auto_complete') {
          queueMicrotask(() => {
            utt.onstart?.();
            queueMicrotask(() => utt.onend?.());
          });
        } else if (speakBehavior === 'not_allowed') {
          queueMicrotask(() => utt.onerror?.({ error: 'not-allowed' }));
        } else if (speakBehavior === 'error') {
          queueMicrotask(() => utt.onerror?.({ error: 'synthesis-failed' }));
        }
      }),
    };

    const storage = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => storage.get(k) ?? null,
        setItem: (k: string, v: string) => storage.set(k, v),
        removeItem: (k: string) => storage.delete(k),
      },
      speechSynthesis: mockSpeechSynthesis,
      SpeechSynthesisUtterance: MockUtterance,
    });
  });

  afterEach(() => {
    stopAllVoicePlayback();
    stopActiveListening();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('TEST 1 & 2 & 3 (Backend Audio): plays validated WAV from Gemini TTS and MP3 from Cloud TTS for English, Kannada, and Hindi and revokes ObjectURLs', async () => {
    const validWav = createValidWavBase64(128);
    const validMp3 = Buffer.alloc(160, 0xaa).toString('base64');

    const fetchMock = vi
      .fn()
      // English via Gemini WAV
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          audioAvailable: true,
          audioBase64: validWav,
          mimeType: 'audio/wav',
          provider: 'gemini-3.8-flash-lite-tts',
        }),
      })
      // Kannada via Gemini WAV
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          audioAvailable: true,
          audioBase64: validWav,
          mimeType: 'audio/wav',
          provider: 'gemini-3.8-flash-lite-tts',
        }),
      })
      // Hindi via secondary Cloud TTS MP3
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          audioAvailable: true,
          audioBase64: validMp3,
          mimeType: 'audio/mpeg',
          provider: 'google-cloud-tts',
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const enRes = await speakTextWithFallback({
      text: 'Your next medicine is Metformin at 08:00.',
      languageCode: 'en',
      rate: 0.95,
    });
    expect(enRes.spoken).toBe(true);
    expect(enRes.engine).toBe('gemini-3.8-flash-lite-tts');

    const knRes = await speakTextWithFallback({
      text: 'ನಿಮ್ಮ ಮುಂದಿನ ಔಷಧಿ ಮೆಟ್‌ಫಾರ್ಮಿನ್ 500 mg.',
      languageCode: 'kn',
      rate: 0.85,
    });
    expect(knRes.spoken).toBe(true);
    expect(knRes.engine).toBe('gemini-3.8-flash-lite-tts');

    const hiRes = await speakTextWithFallback({
      text: 'आपकी अगली दवा मेटफॉर्मिन सुबह 8 बजे है।',
      languageCode: 'hi',
      rate: 1.0,
    });
    expect(hiRes.spoken).toBe(true);
    expect(hiRes.engine).toBe('google-cloud-tts');

    // Verify all 3 Audio objects used playsinline + ObjectURL and revoked every ObjectURL on end
    expect(createdAudioInstances).toHaveLength(3);
    expect(createdAudioInstances[0].attributes.playsinline).toBe('true');
    expect(revokedUrls).toEqual(createdUrls);
  });

  it('TEST 1 & 2 & 3 (Async Voices Fallback): waits for async Chromium voiceschanged before picking en-IN, kn-IN, hi-IN voices', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, audioAvailable: false, reason: 'No server key' }),
    }));

    // Simulate Chromium cold-start returning [] first, then firing voiceschanged after 40ms
    setTimeout(() => {
      synthVoices = [
        makeFakeVoice('Google English India', 'en-IN'),
        makeFakeVoice('Google ಕನ್ನಡ', 'kn-IN'),
        makeFakeVoice('Google हिन्दी', 'hi-IN'),
      ];
      voicesChangedListeners.forEach((cb) => cb());
    }, 30);

    const waited = await waitForSpeechSynthesisVoices(400);
    expect(waited).toHaveLength(3);

    const knRes = await speakTextWithFallback({
      text: 'ನಿಮ್ಮ ಮುಂದಿನ ಔಷಧಿ',
      languageCode: 'kn',
    });
    expect(knRes.spoken).toBe(true);
    expect(knRes.engine).toBe('browser_tts');
    expect(spokenUtterances[0].lang).toBe('kn-IN');
    expect(spokenUtterances[0].voice?.name).toBe('Google ಕನ್ನಡ');

    const hiRes = await speakTextWithFallback({
      text: 'आपकी अगली दवा',
      languageCode: 'hi',
    });
    expect(hiRes.spoken).toBe(true);
    expect(spokenUtterances[1].lang).toBe('hi-IN');

    // Live capability check now accurately sees the loaded voice
    expect(detectVoiceCapabilities('kn').hasVoiceForLanguage).toBe(true);
    expect(pickBestBrowserVoice('hi', synthVoices)?.lang).toBe('hi-IN');
  });

  it('TEST 4 & 5 & 6: supports two-way language switching (en -> kn -> hi) and clean Repeat playback without overlap', async () => {
    const validWav = createValidWavBase64(80);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        audioAvailable: true,
        audioBase64: validWav,
        mimeType: 'audio/wav',
        provider: 'gemini-3.8-flash-lite-tts',
      }),
    }));

    const first = await speakTextWithFallback({
      text: 'Opening Medications.',
      languageCode: 'en',
    });
    expect(first.spoken).toBe(true);

    // Mid-conversation switch to Kannada then Hindi
    const second = await speakTextWithFallback({
      text: 'ನಿಮ್ಮ ಮುಂದಿನ ಔಷಧಿ ಮೆಟ್‌ಫಾರ್ಮಿನ್.',
      languageCode: 'kn',
    });
    expect(second.spoken).toBe(true);

    const third = await speakTextWithFallback({
      text: 'आपकी अगली दवा मेटफॉर्मिन है।',
      languageCode: 'hi',
    });
    expect(third.spoken).toBe(true);

    // Repeat the Hindi message cleanly
    const repeat = await speakTextWithFallback({
      text: 'आपकी अगली दवा मेटफॉर्मिन है।',
      languageCode: 'hi',
    });
    expect(repeat.spoken).toBe(true);
    expect(synthCancelSpy).toHaveBeenCalledTimes(8);
  });

  it('TEST 7: Stop audio immediately interrupts active playback and revokes ObjectURL cleanly', async () => {
    const validWav = createValidWavBase64(80);
    // Keep audio playing without auto-completing
    vi.stubGlobal('Audio', class HangingAudio {
      src = '';
      playbackRate = 1;
      preload = '';
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      pause = vi.fn();
      load = vi.fn();
      setAttribute() {}
      removeAttribute() {}
      play = vi.fn().mockResolvedValue(undefined);
    });

    const playPromise = playCachedAudioBuffer({
      cachedAudio: {
        base64: validWav,
        mimeType: 'audio/wav',
        languageCode: 'en',
        rate: 0.95,
      },
    });

    await new Promise((r) => setTimeout(r, 15));
    stopAllVoicePlayback();

    const stopped = await playPromise;
    expect(stopped.spoken).toBe(false);
    expect(stopped.reason).toContain('stopped');
    expect(revokedUrls).toEqual(createdUrls);
  });

  it('TEST 8: does NOT silently fall back to English for unsupported language (brx) and reports honest reason', async () => {
    synthVoices = [makeFakeVoice('Google US English', 'en-US')];
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const brxRes = await speakTextWithFallback({
      text: 'बड़ो संदेश',
      languageCode: 'brx',
    });

    expect(brxRes.spoken).toBe(false);
    expect(brxRes.engine).toBeUndefined();
    expect(spokenUtterances).toHaveLength(0); // Never read non-English script in English voice!
    expect(fetchMock).not.toHaveBeenCalled();
    expect(brxRes.reason).toContain('No Bodo');
  });

  it('TEST 9: recovers cleanly from backend network failure and falls back to browser voice without throwing', async () => {
    synthVoices = [makeFakeVoice('Google हिन्दी', 'hi-IN')];
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network offline')));

    const res = await speakTextWithFallback({
      text: 'आपकी अगली दवा',
      languageCode: 'hi',
    });

    expect(res.spoken).toBe(true);
    expect(res.engine).toBe('browser_tts');

    // If browser speech daemon also silently hangs (e.g., headless Chrome), watchdog resolves honestly in <=2s
    vi.useFakeTimers();
    speakBehavior = 'hang';
    const hangPromise = speakTextWithFallback({
      text: 'आपकी अगली दवा',
      languageCode: 'hi',
    });
    await vi.advanceTimersByTimeAsync(2000);
    const hangResult = await hangPromise;
    expect(hangResult.spoken).toBe(false);
    expect(hangResult.reason).toContain('did not produce');
  });

  it('TEST 10: handles mobile Chrome Android NotAllowedError autoplay block with cachedAudio + tap-to-play recovery', async () => {
    const validWav = createValidWavBase64(96);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        audioAvailable: true,
        audioBase64: validWav,
        mimeType: 'audio/wav',
        provider: 'gemini-3.8-flash-lite-tts',
      }),
    }));

    // First play rejects with NotAllowedError (simulating Chrome Android expired gesture token after async fetch)
    let attempt = 0;
    vi.stubGlobal('Audio', class MobileAudio {
      src = '';
      playbackRate = 1;
      preload = '';
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      pause = vi.fn();
      load = vi.fn();
      setAttribute() {}
      removeAttribute() {}
      play = vi.fn().mockImplementation(async () => {
        attempt++;
        if (attempt === 1) {
          throw new DOMException('play() failed because the user did not interact first.', 'NotAllowedError');
        }
        queueMicrotask(() => this.onended?.());
      });
    });

    const firstTry = await speakTextWithFallback({
      text: 'Your next scheduled medicine is Metformin.',
      languageCode: 'en',
    });

    expect(firstTry.spoken).toBe(false);
    expect(firstTry.autoplayBlocked).toBe(true);
    expect(firstTry.cachedAudio?.base64).toBe(validWav);
    expect(revokedUrls).toEqual(createdUrls); // Initial blocked URL revoked immediately

    // User taps "Tap to Play Audio" -> unlocks audio context and plays cached buffer directly
    unlockMobileAudioPlayback();
    const secondTry = await playCachedAudioBuffer({
      cachedAudio: firstTry.cachedAudio!,
    });
    expect(secondTry.spoken).toBe(true);
    expect(secondTry.engine).toBe('gemini-3.8-flash-lite-tts');
  });

  it('TEST 11: validates Blob/WAV integrity and keeps SpeechRecognition STT flow intact', async () => {
    expect(() => createAudioBlobFromBase64('', 'audio/wav')).toThrow();
    expect(() => createAudioBlobFromBase64(Buffer.from('tiny').toString('base64'), 'audio/wav')).toThrow();
    const validBlob = createAudioBlobFromBase64(createValidWavBase64(40), 'audio/wav');
    expect(validBlob.size).toBe(84);
    expect(validBlob.type).toBe('audio/wav');

    // Verify ensureValidWavBase64 wraps headerless 24kHz PCM into valid RIFF WAV and preserves existing RIFF
    const rawPcm = Buffer.alloc(64, 0x11).toString('base64');
    const wrapped = ensureValidWavBase64(rawPcm);
    expect(wrapped).not.toBeNull();
    expect(Buffer.from(wrapped!.base64, 'base64').subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wrapped!.byteLength).toBe(44 + 64);

    // Existing STT SpeechRecognition capture continues working normally
    let capturedTranscript = '';
    class MockRecognition {
      lang = '';
      interimResults = false;
      maxAlternatives = 1;
      continuous = false;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      stop = vi.fn();
      start = () => {
        queueMicrotask(() => {
          const item = Object.assign([{ transcript: 'Show my upcoming appointments' }], { isFinal: true });
          this.onresult?.({ results: [item] });
        });
      };
    }

    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() }],
        }),
      },
    });
    const currentWin = (globalThis as unknown as { window: Record<string, unknown> }).window;
    currentWin.SpeechRecognition = MockRecognition;

    await new Promise<void>((resolve) => {
      startVoiceListening({
        languageCode: 'en',
        onFinalTranscript: ({ transcript }) => {
          capturedTranscript = transcript;
          resolve();
        },
        onError: () => resolve(),
      });
    });

    expect(capturedTranscript).toBe('Show my upcoming appointments');
  });

  it('SCENARIO 1 & 2 & 8: prefers en-IN, falls back to en-US then other English voices, and normalizes Android underscore tags (en_US, en_IN)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    // 1. Both en-IN and en-US installed -> picks en-IN cleanly without hitting server
    synthVoices = [
      makeFakeVoice('Samantha', 'en-GB'),
      makeFakeVoice('Google US English', 'en-US'),
      makeFakeVoice('Google English India', 'en_IN'),
    ];
    const inRes = await speakTextWithFallback({
      text: 'Take Metformin 500 mg at 8 AM.',
      languageCode: 'en',
    });
    expect(inRes.spoken).toBe(true);
    expect(inRes.engine).toBe('browser_tts');
    expect(inRes.voiceLang).toBe('en-IN');
    expect(fetchMock).not.toHaveBeenCalled();

    // 2. Only en_US and en-AU installed (no en-IN) -> falls back to en-US cleanly
    synthVoices = [
      makeFakeVoice('Karen', 'en-AU'),
      makeFakeVoice('Android English US', 'en_US'),
      makeFakeVoice('Google UK Female', 'en-GB'),
    ];
    const usRes = await speakTextWithFallback({
      text: 'Your doctor visit is tomorrow.',
      languageCode: 'en',
    });
    expect(usRes.spoken).toBe(true);
    expect(usRes.voiceLang).toBe('en-US');
    expect(getBrowserVoiceInventorySummary('en').matchingTags).toEqual(['en-au', 'en-us', 'en-gb']);

    // 3. Android Chrome SpeechSynthesis blocked due to async gesture loss (not-allowed) -> returns autoplayBlocked: true
    speakBehavior = 'not_allowed';
    const blockedRes = await speakTextWithFallback({
      text: 'Tap Play Audio to listen.',
      languageCode: 'en',
    });
    expect(blockedRes.spoken).toBe(false);
    expect(blockedRes.autoplayBlocked).toBe(true);
    expect(blockedRes.reason).toContain('Tap "Play Audio"');
  });

  it('SCENARIO 3 & 4 & 6: detects delayed voices via polling fallback, auto-falls back when browser lacks English, and explains config when server TTS is unavailable', async () => {
    // 1. Delayed voice polling (Android WebView never fires voiceschanged, populates asynchronously at 150ms)
    setTimeout(() => {
      synthVoices = [makeFakeVoice('Android English US', 'en_US')];
    }, 150);
    const polled = await waitForSpeechSynthesisVoices(600);
    expect(polled).toHaveLength(1);
    expect(pickBestBrowserVoice('en', polled)?.lang).toBe('en_US');

    // 2. Browser has ONLY German voice (no English voice) + Server TTS configured -> falls back cleanly to server WAV
    synthVoices = [makeFakeVoice('German Voice', 'de-DE')];
    const validWav = createValidWavBase64(100);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        audioAvailable: true,
        audioBase64: validWav,
        mimeType: 'audio/wav',
        provider: 'gemini-3.8-flash-lite-tts',
      }),
    }));
    const serverFallbackRes = await speakTextWithFallback({
      text: 'Hello, checking server fallback.',
      languageCode: 'en',
    });
    expect(serverFallbackRes.spoken).toBe(true);
    expect(serverFallbackRes.engine).toBe('gemini-3.8-flash-lite-tts');

    // 3. Browser has ONLY German voice AND no server TTS configured -> refuses false success and names missing config
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        audioAvailable: false,
        provider: 'none',
        reason: 'GEMINI_API_KEY is not configured on the server.',
      }),
    }));
    const honestFail = await speakTextWithFallback({
      text: 'Hello, testing missing configuration.',
      languageCode: 'en',
    });
    expect(honestFail.spoken).toBe(false);
    expect(honestFail.reason).toContain('No en-IN, en-US, or English voice is installed');
    expect(honestFail.reason).toContain('deployment Secrets');
  });

  it('SCENARIO 9: chunks long AI responses cleanly into <=180-char segments for reliable Chrome SpeechSynthesis playback and validates server 2400-char limit', async () => {
    const longReply =
      'Good morning Raghavan. Today you have three scheduled doses on your CareBridge plan. ' +
      'First, Metformin 500 mg at 08:00 AM with breakfast to keep morning blood sugar steady. ' +
      'Second, Amlodipine 5 mg at 09:00 AM with a full glass of water. ' +
      'Third, Atorvastatin 10 mg at 09:00 PM after dinner. ' +
      'Your next appointment with Dr. Ananya Nair at Bengaluru Care Clinic is confirmed for Friday at 10:30 AM.';

    const chunks = splitTextForSpeech(longReply, 180);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(180);
    }

    synthVoices = [makeFakeVoice('Google English India', 'en-IN')];
    const longPlay = await speakTextWithFallback({
      text: longReply,
      languageCode: 'en',
    });
    expect(longPlay.spoken).toBe(true);
    expect(spokenUtterances.length).toBe(chunks.length);
    expect(spokenUtterances.map((u) => u.text)).toEqual(chunks);

    // Server validator allows longer AI responses up to 2400 characters
    expect(() =>
      voiceSynthesizeSchema.parse({
        text: longReply.repeat(3),
        languageCode: 'en',
        speakingRate: 0.95,
      }),
    ).not.toThrow();
  });
});
