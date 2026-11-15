import {
  getVoiceLanguageCapability,
  VOICE_LANGUAGE_MATRIX,
  type VoiceLanguageCapability,
} from '../../shared/voiceLanguageMatrix.ts';
import { buildApiUrl } from '../config/api.ts';
import { getLanguageMeta } from '../i18n/languages.ts';
import { getAuthenticatedIdToken } from './firestoreService.ts';

export interface VoiceCapabilities {
  speechSynthesisAvailable: boolean;
  hasVoiceForLanguage: boolean;
  speechRecognitionAvailable: boolean;
  mediaRecorderAvailable: boolean;
  microphoneApiAvailable: boolean;
  matchedVoiceName?: string;
  languageCapability: VoiceLanguageCapability;
}

export type MicrophonePermissionState = 'granted' | 'prompt' | 'denied' | 'unsupported';

export type VoiceErrorCode =
  | 'SESSION_ALREADY_ACTIVE'
  | 'PERMISSION_DENIED'
  | 'NO_MICROPHONE'
  | 'EMPTY_SPEECH'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'UNSUPPORTED_LANGUAGE'
  | 'PLAYBACK_FAILED'
  | 'TRANSCRIPTION_UNAVAILABLE';

export interface CachedAudioPayload {
  base64: string;
  mimeType: 'audio/wav' | 'audio/mpeg';
  languageCode: string;
  rate: number;
}

export interface ServerVoiceCapabilities {
  checked: boolean;
  neuralConfigured: boolean;
  googleCloudTtsConfigured: boolean;
  serverTtsAvailable: boolean;
  ttsProviders: string[];
}

export interface SpeakResult {
  spoken: boolean;
  engine?: 'gemini-3.8-flash-lite-tts' | 'google-cloud-tts' | 'browser_tts';
  voiceName?: string;
  voiceLang?: string;
  autoplayBlocked?: boolean;
  cachedAudio?: CachedAudioPayload;
  reason?: string;
}

export interface VoiceListeningCallbacks {
  languageCode: string;
  autoDetectLanguage?: boolean;
  preferAudioClipCapture?: boolean;
  maxDurationMs?: number;
  onModeSelected?: (mode: 'browser_speech' | 'neural_audio') => void;
  onInterimTranscript?: (text: string) => void;
  onFinalTranscript: (result: {
    transcript: string;
    detectedLanguageCode: string;
    mode: 'browser_speech' | 'neural_audio';
  }) => void;
  onWaveform?: (bars: number[]) => void;
  onStatusChange?: (status: 'requesting_mic' | 'listening' | 'processing' | 'idle') => void;
  onError: (code: VoiceErrorCode, message: string) => void;
}

const SPEECH_RATE_STORAGE_KEY = 'carebridge_voice_rate';
const MIC_CONSENT_STORAGE_KEY = 'carebridge_mic_consent';

let activeListeningCleanup: (() => void) | null = null;
let activeAudioElement: HTMLAudioElement | null = null;
let activeObjectUrl: string | null = null;
let activePlaybackStopper: (() => void) | null = null;
let sharedAudioContext: AudioContext | null = null;
let lastPlaybackSessionId = 0;
let cachedServerCapabilities: ServerVoiceCapabilities = {
  checked: false,
  neuralConfigured: false,
  googleCloudTtsConfigured: false,
  serverTtsAvailable: false,
  ttsProviders: [],
};

export function isMicSessionActive(): boolean {
  return activeListeningCleanup !== null;
}

export function stopActiveListening(): void {
  if (activeListeningCleanup) {
    const cleanup = activeListeningCleanup;
    activeListeningCleanup = null;
    cleanup();
  }
}

export function getSavedVoiceConsent(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(MIC_CONSENT_STORAGE_KEY) === 'granted';
}

export function setSavedVoiceConsent(granted: boolean): void {
  if (typeof window === 'undefined') return;
  if (granted) {
    window.localStorage.setItem(MIC_CONSENT_STORAGE_KEY, 'granted');
  } else {
    window.localStorage.removeItem(MIC_CONSENT_STORAGE_KEY);
  }
}

export function getVoiceSpeechRate(): number {
  if (typeof window === 'undefined') return 0.95;
  const raw = Number(window.localStorage.getItem(SPEECH_RATE_STORAGE_KEY));
  if (!Number.isNaN(raw) && raw >= 0.7 && raw <= 1.3) return raw;
  return 0.95;
}

export function setVoiceSpeechRate(rate: number): void {
  if (typeof window === 'undefined') return;
  const clamped = Math.max(0.7, Math.min(1.3, rate));
  window.localStorage.setItem(SPEECH_RATE_STORAGE_KEY, String(clamped));
}

export function unlockMobileAudioPlayback(): void {
  if (typeof window === 'undefined') return;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioCtx) {
      if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
        sharedAudioContext = new AudioCtx();
      }
      if (sharedAudioContext.state === 'suspended') {
        sharedAudioContext.resume().catch(() => {});
      }
    }
    if ('speechSynthesis' in window && window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
  } catch {
    // Non-fatal on restricted devices
  }
}

export function createAudioBlobFromBase64(
  base64: string,
  mimeType: 'audio/wav' | 'audio/mpeg',
): Blob {
  const cleaned = base64.replace(/\s+/g, '');
  if (!cleaned) {
    throw new Error('Audio response was empty.');
  }
  const binaryString = atob(cleaned);
  if (binaryString.length < 32) {
    throw new Error('Audio response payload was too short to play.');
  }
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

export async function getMicrophonePermissionState(): Promise<MicrophonePermissionState> {
  if (typeof window === 'undefined' || !navigator?.mediaDevices?.getUserMedia) {
    return 'unsupported';
  }
  try {
    if (navigator.permissions && typeof navigator.permissions.query === 'function') {
      const status = await navigator.permissions.query({
        name: 'microphone' as PermissionName,
      });
      if (status.state === 'granted' || status.state === 'denied' || status.state === 'prompt') {
        return status.state;
      }
    }
  } catch {
    // Permissions API for microphone is not supported in all browsers (e.g., Safari)
  }
  return 'prompt';
}

function normalizeVoiceLangTag(rawLang: string | undefined): string {
  return (rawLang || '').trim().replace(/_/g, '-').toLowerCase();
}

function formatBcp47Tag(rawLang: string | undefined): string {
  const cleaned = (rawLang || '').trim().replace(/_/g, '-');
  if (!cleaned) return '';
  const parts = cleaned.split('-');
  if (parts.length === 2) {
    return `${parts[0].toLowerCase()}-${parts[1].toUpperCase()}`;
  }
  return cleaned;
}

export function getServerVoiceCapabilitiesSnapshot(): ServerVoiceCapabilities {
  return cachedServerCapabilities;
}

export async function fetchServerVoiceCapabilities(
  forceRefresh = false,
): Promise<ServerVoiceCapabilities> {
  if (cachedServerCapabilities.checked && !forceRefresh) {
    return cachedServerCapabilities;
  }
  try {
    const token = await getAuthenticatedIdToken();
    if (!token) {
      return cachedServerCapabilities;
    }
    const res = await fetch(buildApiUrl('/api/v1/voice/capabilities'), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      return cachedServerCapabilities;
    }
    const data = (await res.json()) as {
      ok?: boolean;
      neuralConfigured?: boolean;
      googleCloudTtsConfigured?: boolean;
      ttsProviders?: string[];
    };
    if (data.ok) {
      const neural = Boolean(data.neuralConfigured);
      const cloud = Boolean(data.googleCloudTtsConfigured);
      cachedServerCapabilities = {
        checked: true,
        neuralConfigured: neural,
        googleCloudTtsConfigured: cloud,
        serverTtsAvailable: neural || cloud,
        ttsProviders: Array.isArray(data.ttsProviders) ? data.ttsProviders : [],
      };
    }
  } catch {
    // Preserve previous capability snapshot cleanly on transient network failures
  }
  return cachedServerCapabilities;
}

export function pickBestBrowserVoice(
  languageCode: string,
  voices: SpeechSynthesisVoice[],
): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const meta = getLanguageMeta(languageCode);
  const bcpLower = normalizeVoiceLangTag(meta.bcp47);
  const baseTag = bcpLower.split('-')[0];

  const candidates = voices.filter((v) => {
    const normalized = normalizeVoiceLangTag(v.lang);
    if (
      normalized === bcpLower ||
      normalized.startsWith(`${baseTag}-`) ||
      normalized === baseTag
    ) {
      return true;
    }
    if (baseTag === 'en') {
      const nameLower = (v.name || '').toLowerCase();
      return (
        normalized.startsWith('eng') ||
        (nameLower.includes('english') && (!normalized || normalized.startsWith('en')))
      );
    }
    return false;
  });

  if (!candidates.length) return null;

  const scoreVoice = (v: SpeechSynthesisVoice): number => {
    const normalized = normalizeVoiceLangTag(v.lang);
    const nameLower = (v.name || '').toLowerCase();
    let score = 0;

    if (normalized === bcpLower) {
      score += 100; // Prefer exact tag (e.g. en-IN, hi-IN, kn-IN)
    } else if (baseTag === 'en') {
      if (normalized === 'en-us') score += 70; // Explicit #2 English fallback: en-US
      else if (normalized === 'en-gb') score += 55;
      else if (normalized === 'en-au' || normalized === 'en-ca') score += 45;
      else if (normalized.startsWith('en-') || normalized === 'en') score += 35;
      else score += 20;
    } else if (normalized.startsWith(`${baseTag}-`) || normalized === baseTag) {
      score += 50;
    }

    if (nameLower.includes('google') || nameLower.includes('natural')) score += 10;
    if (v.localService) score += 4;
    if (v.default && normalized.startsWith(baseTag)) score += 2;
    return score;
  };

  candidates.sort((a, b) => scoreVoice(b) - scoreVoice(a));
  return candidates[0];
}

export function getBrowserVoiceInventorySummary(languageCode: string): {
  totalVoices: number;
  matchingTags: string[];
  preferredVoice?: { name: string; lang: string };
} {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return { totalVoices: 0, matchingTags: [] };
  }
  const voices = window.speechSynthesis.getVoices();
  const baseTag = normalizeVoiceLangTag(getLanguageMeta(languageCode).bcp47).split('-')[0];
  const matching = voices.filter((v) => {
    const norm = normalizeVoiceLangTag(v.lang);
    return norm === baseTag || norm.startsWith(`${baseTag}-`);
  });
  const tags = Array.from(
    new Set(matching.map((v) => normalizeVoiceLangTag(v.lang)).filter(Boolean)),
  );
  const preferred = pickBestBrowserVoice(languageCode, voices);
  return {
    totalVoices: voices.length,
    matchingTags: tags,
    preferredVoice: preferred
      ? { name: preferred.name, lang: formatBcp47Tag(preferred.lang) || preferred.lang }
      : undefined,
  };
}

export async function waitForSpeechSynthesisVoices(
  timeoutMs = 700,
): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return [];
  }
  const initial = window.speechSynthesis.getVoices();
  if (initial.length > 0) return initial;

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.speechSynthesis.removeEventListener?.('voiceschanged', onVoicesChanged);
      clearInterval(pollTimer);
      clearTimeout(timer);
      resolve(window.speechSynthesis.getVoices());
    };
    const onVoicesChanged = () => {
      if (window.speechSynthesis.getVoices().length > 0) {
        finish();
      }
    };
    // Chrome Android / WebView sometimes populates getVoices() asynchronously without re-firing voiceschanged
    const pollTimer = setInterval(() => {
      const polled = window.speechSynthesis.getVoices();
      if (polled.length > 0) {
        finish();
      }
    }, 100);
    const timer = setTimeout(finish, timeoutMs);
    window.speechSynthesis.addEventListener?.('voiceschanged', onVoicesChanged);
  });
}

export async function refreshBrowserVoices(): Promise<SpeechSynthesisVoice[]> {
  return waitForSpeechSynthesisVoices(700);
}

export function subscribeVoiceListChanged(callback: () => void): () => void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return () => {};
  }
  window.speechSynthesis.addEventListener?.('voiceschanged', callback);
  return () => {
    window.speechSynthesis.removeEventListener?.('voiceschanged', callback);
  };
}

export function detectVoiceCapabilities(languageCode: string): VoiceCapabilities {
  const languageCapability = getVoiceLanguageCapability(languageCode);

  if (typeof window === 'undefined') {
    return {
      speechSynthesisAvailable: false,
      hasVoiceForLanguage: false,
      speechRecognitionAvailable: false,
      mediaRecorderAvailable: false,
      microphoneApiAvailable: false,
      languageCapability,
    };
  }

  const synthAvailable =
    'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  let hasVoice = false;
  let matchedVoiceName: string | undefined;

  if (synthAvailable) {
    const voices = window.speechSynthesis.getVoices();
    const matched = pickBestBrowserVoice(languageCode, voices);
    if (matched) {
      hasVoice = true;
      matchedVoiceName = matched.name;
    }
  }

  const win = window as unknown as {
    SpeechRecognition?: new () => unknown;
    webkitSpeechRecognition?: new () => unknown;
  };
  const speechRecognitionAvailable = Boolean(win.SpeechRecognition || win.webkitSpeechRecognition);
  const microphoneApiAvailable = Boolean(navigator?.mediaDevices?.getUserMedia);
  const mediaRecorderAvailable = typeof MediaRecorder !== 'undefined' && microphoneApiAvailable;

  return {
    speechSynthesisAvailable: synthAvailable,
    hasVoiceForLanguage: hasVoice,
    speechRecognitionAvailable,
    mediaRecorderAvailable,
    microphoneApiAvailable,
    matchedVoiceName,
    languageCapability,
  };
}

export function stopAllVoicePlayback(): void {
  lastPlaybackSessionId++;
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore synthesis cancel errors
    }
  }
  if (activeAudioElement) {
    try {
      activeAudioElement.onended = null;
      activeAudioElement.onerror = null;
      activeAudioElement.pause();
      activeAudioElement.removeAttribute('src');
      activeAudioElement.load();
    } catch {
      // ignore audio stop errors
    }
    activeAudioElement = null;
  }
  if (activeObjectUrl) {
    try {
      URL.revokeObjectURL(activeObjectUrl);
    } catch {
      // ignore revoke errors
    }
    activeObjectUrl = null;
  }
  if (activePlaybackStopper) {
    const fn = activePlaybackStopper;
    activePlaybackStopper = null;
    fn();
  }
}

export function speakTextInLanguage(text: string, languageCode: string, rate?: number): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return false;
  }
  const caps = detectVoiceCapabilities(languageCode);
  if (!caps.speechSynthesisAvailable) {
    return false;
  }
  const voices = window.speechSynthesis.getVoices();
  const matchedVoice = pickBestBrowserVoice(languageCode, voices);
  if (voices.length > 0 && !matchedVoice) {
    return false;
  }

  stopAllVoicePlayback();
  const utterance = new SpeechSynthesisUtterance(text);
  const meta = getLanguageMeta(languageCode);
  utterance.lang = matchedVoice
    ? formatBcp47Tag(matchedVoice.lang) || meta.bcp47
    : meta.bcp47;
  if (matchedVoice) utterance.voice = matchedVoice;
  utterance.rate = rate ?? getVoiceSpeechRate();
  window.speechSynthesis.speak(utterance);
  return true;
}

export async function playCachedAudioBuffer(params: {
  cachedAudio: CachedAudioPayload;
  onStart?: (engine: 'gemini-3.8-flash-lite-tts' | 'google-cloud-tts' | 'browser_tts') => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
  provider?: 'gemini-3.8-flash-lite-tts' | 'google-cloud-tts';
}): Promise<SpeakResult> {
  stopAllVoicePlayback();
  const sessionId = ++lastPlaybackSessionId;
  const providerEngine = params.provider || 'gemini-3.8-flash-lite-tts';

  let blob: Blob;
  try {
    blob = createAudioBlobFromBase64(params.cachedAudio.base64, params.cachedAudio.mimeType);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Invalid synthesized audio payload.';
    params.onError?.(msg);
    params.onEnd?.();
    return { spoken: false, reason: msg };
  }

  const objectUrl = URL.createObjectURL(blob);
  activeObjectUrl = objectUrl;

  return new Promise((resolve) => {
    let settled = false;
    const audio = new Audio();
    audio.setAttribute('playsinline', 'true');
    audio.preload = 'auto';
    audio.src = objectUrl;
    audio.playbackRate = params.cachedAudio.rate;
    activeAudioElement = audio;

    const cleanupAudio = () => {
      audio.onended = null;
      audio.onerror = null;
      if (activeAudioElement === audio) {
        activeAudioElement = null;
      }
      if (activeObjectUrl === objectUrl) {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch {
          // ignore
        }
        activeObjectUrl = null;
      }
      if (activePlaybackStopper === stopHandler) {
        activePlaybackStopper = null;
      }
    };

    const stopHandler = () => {
      if (!settled) {
        settled = true;
        cleanupAudio();
        params.onEnd?.();
        resolve({ spoken: false, reason: 'Playback stopped.' });
      }
    };

    activePlaybackStopper = stopHandler;

    audio.onended = () => {
      if (!settled) {
        settled = true;
        cleanupAudio();
        params.onEnd?.();
        resolve({ spoken: true, engine: providerEngine });
      }
    };

    audio.onerror = () => {
      if (!settled) {
        settled = true;
        cleanupAudio();
        params.onEnd?.();
        params.onError?.('Browser could not decode or play audio response.');
        resolve({ spoken: false, reason: 'Audio playback error.' });
      }
    };

    audio
      .play()
      .then(() => {
        if (sessionId !== lastPlaybackSessionId) {
          cleanupAudio();
          return;
        }
        params.onStart?.(providerEngine);
      })
      .catch((err) => {
        if (settled) return;
        settled = true;
        cleanupAudio();
        params.onEnd?.();
        const isAutoplayBlocked =
          err instanceof DOMException &&
          (err.name === 'NotAllowedError' || err.name === 'AbortError');
        if (isAutoplayBlocked) {
          resolve({
            spoken: false,
            autoplayBlocked: true,
            cachedAudio: params.cachedAudio,
            reason: 'Tap "Play Audio" below to hear spoken response on this mobile browser.',
          });
        } else {
          const msg = 'Unable to start audio playback.';
          params.onError?.(msg);
          resolve({ spoken: false, reason: msg });
        }
      });
  });
}

export function splitTextForSpeech(text: string, maxChunkLen = 180): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  if (normalized.length <= maxChunkLen) return [normalized];

  // Split by sentence terminators (Latin + Devanagari/Indic danda) while keeping punctuation
  const sentences = normalized.split(/(?<=[.!?।॥\n])\s+/);
  const chunks: string[] = [];
  let current = '';

  const pushOversizedSegment = (segment: string) => {
    const words = segment.split(' ');
    let line = '';
    for (const word of words) {
      if (line && line.length + 1 + word.length > maxChunkLen) {
        chunks.push(line.trim());
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line.trim()) chunks.push(line.trim());
  };

  for (const sentence of sentences) {
    if (!sentence) continue;
    if (sentence.length > maxChunkLen) {
      if (current.trim()) {
        chunks.push(current.trim());
        current = '';
      }
      pushOversizedSegment(sentence);
      continue;
    }
    if (current && current.length + 1 + sentence.length > maxChunkLen) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

async function tryBrowserSpeechSynthesis(params: {
  text: string;
  languageCode: string;
  rate: number;
  prefetchedVoices?: SpeechSynthesisVoice[];
  onStart?: (engine: 'gemini-3.8-flash-lite-tts' | 'google-cloud-tts' | 'browser_tts') => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
}): Promise<SpeakResult> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return { spoken: false, reason: 'Browser SpeechSynthesis is not supported on this device.' };
  }

  const cap = getVoiceLanguageCapability(params.languageCode);
  const voices =
    params.prefetchedVoices ?? (await waitForSpeechSynthesisVoices(700));
  const matchedVoice = pickBestBrowserVoice(params.languageCode, voices);

  // Never fall back to an English voice when user requested another language whose voices are absent
  if (voices.length > 0 && !matchedVoice) {
    const checkedDesc =
      cap.code === 'en' ? 'en-IN, en-US, or English' : `${cap.englishName} (${cap.bcp47})`;
    return {
      spoken: false,
      reason: `No ${checkedDesc} voice is installed in this browser.`,
    };
  }

  if (voices.length === 0 && !cap.browserSttExpected) {
    return {
      spoken: false,
      reason: `${cap.englishName} spoken voice is not available natively in this browser.`,
    };
  }

  const chunks = splitTextForSpeech(params.text, 180);
  if (!chunks.length) {
    return { spoken: false, reason: 'Nothing to read aloud.' };
  }

  const sessionId = ++lastPlaybackSessionId;
  const meta = getLanguageMeta(params.languageCode);
  const resolvedLang = matchedVoice
    ? formatBcp47Tag(matchedVoice.lang) || meta.bcp47
    : meta.bcp47;

  return new Promise((resolve) => {
    let settled = false;
    let startedAny = false;
    let chunkIndex = 0;
    let startWatchdog: ReturnType<typeof setTimeout> | null = null;

    const clearWatchdog = () => {
      if (startWatchdog) {
        clearTimeout(startWatchdog);
        startWatchdog = null;
      }
    };

    const finishWith = (result: SpeakResult, notifyEnd = true) => {
      clearWatchdog();
      if (!settled) {
        settled = true;
        if (activePlaybackStopper === stopHandler) {
          activePlaybackStopper = null;
        }
        if (notifyEnd) params.onEnd?.();
        resolve(result);
      }
    };

    const stopHandler = () => {
      finishWith({ spoken: false, reason: 'Playback stopped.' }, true);
    };
    activePlaybackStopper = stopHandler;

    const speakNextChunk = () => {
      if (settled || sessionId !== lastPlaybackSessionId) {
        finishWith({ spoken: false, reason: 'Playback stopped.' }, false);
        return;
      }
      if (chunkIndex >= chunks.length) {
        finishWith(
          {
            spoken: true,
            engine: 'browser_tts',
            voiceName: matchedVoice?.name,
            voiceLang: resolvedLang,
          },
          true,
        );
        return;
      }

      const chunkText = chunks[chunkIndex++];
      const utterance = new SpeechSynthesisUtterance(chunkText);
      utterance.lang = resolvedLang;
      if (matchedVoice) utterance.voice = matchedVoice;
      utterance.rate = params.rate;

      clearWatchdog();
      startWatchdog = setTimeout(() => {
        if (!startedAny && !settled) {
          try {
            window.speechSynthesis.cancel();
          } catch {
            // ignore
          }
          finishWith(
            {
              spoken: false,
              reason: `Browser speech engine did not produce ${cap.englishName} audio.`,
            },
            false,
          );
        }
      }, 1800);

      utterance.onstart = () => {
        if (sessionId !== lastPlaybackSessionId || settled) return;
        clearWatchdog();
        if (!startedAny) {
          startedAny = true;
          params.onStart?.('browser_tts');
        }
      };

      utterance.onend = () => {
        clearWatchdog();
        if (settled || sessionId !== lastPlaybackSessionId) return;
        speakNextChunk();
      };

      utterance.onerror = (ev) => {
        clearWatchdog();
        if (settled || sessionId !== lastPlaybackSessionId) return;
        const errCode = (ev as SpeechSynthesisErrorEvent | undefined)?.error;
        if (errCode === 'canceled' || errCode === 'interrupted') {
          finishWith({ spoken: false, reason: 'Playback stopped.' }, true);
          return;
        }
        if (errCode === 'not-allowed') {
          finishWith(
            {
              spoken: false,
              autoplayBlocked: true,
              reason: 'Tap "Play Audio" below to hear spoken response on mobile.',
            },
            true,
          );
          return;
        }
        finishWith(
          {
            spoken: false,
            reason: `Browser speech synthesis error (${errCode || 'unavailable'}) for ${cap.englishName}.`,
          },
          true,
        );
      };

      try {
        if (chunkIndex === 1) {
          window.speechSynthesis.cancel();
        }
        window.speechSynthesis.speak(utterance);
      } catch {
        finishWith(
          {
            spoken: false,
            reason: `Browser speech synthesis could not start for ${cap.englishName}.`,
          },
          false,
        );
      }
    };

    speakNextChunk();
  });
}

async function requestServerSpeechSynthesis(
  text: string,
  languageCode: string,
  rate: number,
): Promise<{
  audioAvailable: boolean;
  audioBase64?: string;
  mimeType?: 'audio/wav' | 'audio/mpeg';
  provider?: 'gemini-3.8-flash-lite-tts' | 'google-cloud-tts' | 'none';
  reason?: string;
}> {
  const token = await getAuthenticatedIdToken();
  if (!token) {
    return { audioAvailable: false, reason: 'Sign-in required for backend audio synthesis.' };
  }

  const res = await fetch(buildApiUrl('/api/v1/voice/synthesize'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      text: text.slice(0, 2400),
      languageCode,
      speakingRate: rate,
    }),
  });

  if (!res.ok) {
    return { audioAvailable: false, reason: `TTS backend returned status ${res.status}.` };
  }

  const data = (await res.json()) as {
    ok: boolean;
    audioAvailable?: boolean;
    audioBase64?: string;
    mimeType?: 'audio/wav' | 'audio/mpeg';
    provider?: 'gemini-3.8-flash-lite-tts' | 'google-cloud-tts' | 'none';
    reason?: string;
  };

  if (!data.ok || !data.audioAvailable || !data.audioBase64) {
    return {
      audioAvailable: false,
      provider: data.provider || 'none',
      reason: data.reason || 'Server TTS provider is not configured.',
    };
  }

  return {
    audioAvailable: true,
    audioBase64: data.audioBase64,
    mimeType: data.mimeType || 'audio/wav',
    provider: data.provider || 'gemini-3.8-flash-lite-tts',
  };
}

export async function speakTextWithFallback(params: {
  text: string;
  languageCode: string;
  rate?: number;
  preferServerTts?: boolean;
  onStart?: (engine: 'gemini-3.8-flash-lite-tts' | 'google-cloud-tts' | 'browser_tts') => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
}): Promise<SpeakResult> {
  const cleaned = params.text.trim();
  if (!cleaned) {
    params.onEnd?.();
    return { spoken: false, reason: 'Nothing to read aloud.' };
  }

  stopAllVoicePlayback();
  const rate = params.rate ?? getVoiceSpeechRate();
  const cap = getVoiceLanguageCapability(params.languageCode);

  const tryServerPath = async (): Promise<{ result?: SpeakResult; reason?: string }> => {
    if (cap.neuralServerSupport === 'experimental') {
      return { reason: `${cap.englishName} spoken synthesis is experimental only.` };
    }
    try {
      const serverAudio = await requestServerSpeechSynthesis(cleaned, cap.code, rate);
      if (serverAudio.audioAvailable && serverAudio.audioBase64 && serverAudio.mimeType) {
        const playResult = await playCachedAudioBuffer({
          cachedAudio: {
            base64: serverAudio.audioBase64,
            mimeType: serverAudio.mimeType,
            languageCode: cap.code,
            rate,
          },
          provider:
            serverAudio.provider === 'google-cloud-tts'
              ? 'google-cloud-tts'
              : 'gemini-3.8-flash-lite-tts',
          onStart: params.onStart,
          onEnd: params.onEnd,
          onError: params.onError,
        });
        if (playResult.spoken || playResult.autoplayBlocked) {
          return { result: playResult };
        }
        return { reason: playResult.reason };
      }
      return { reason: serverAudio.reason };
    } catch (err) {
      return {
        reason: err instanceof Error ? err.message : 'Network error calling TTS service.',
      };
    }
  };

  // Detect browser voices (awaits delayed Android/Chrome voice population if initially empty)
  let browserVoices: SpeechSynthesisVoice[] = [];
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    const syncVoices = window.speechSynthesis.getVoices();
    browserVoices =
      syncVoices.length > 0 ? syncVoices : await waitForSpeechSynthesisVoices(700);
  }
  const matchedBrowserVoice = pickBestBrowserVoice(cap.code, browserVoices);

  // If browser has an installed matching voice and server TTS isn't explicitly preferred,
  // speak natively right away so Chrome Android keeps synchronous gesture eligibility!
  let browserReason: string | undefined;
  let serverReason: string | undefined;

  const tryBrowserFirst =
    !params.preferServerTts &&
    Boolean(matchedBrowserVoice) &&
    !cachedServerCapabilities.serverTtsAvailable;

  if (tryBrowserFirst) {
    const browserResult = await tryBrowserSpeechSynthesis({
      text: cleaned,
      languageCode: cap.code,
      rate,
      prefetchedVoices: browserVoices,
      onStart: params.onStart,
      onEnd: params.onEnd,
      onError: params.onError,
    });
    if (browserResult.spoken || browserResult.autoplayBlocked) {
      return browserResult;
    }
    browserReason = browserResult.reason;
  }

  // Automatic Fallback (or primary when server TTS is configured or browser has no voice):
  // Try configured backend TTS provider (Gemini 3.8 Neural TTS -> Google Cloud TTS)
  const serverAttempt = await tryServerPath();
  if (serverAttempt.result) {
    return serverAttempt.result;
  }
  serverReason = serverAttempt.reason;

  // If browser was NOT tried yet (e.g. server was tried first because voice was empty/untested or configured)
  if (!tryBrowserFirst) {
    const browserResult = await tryBrowserSpeechSynthesis({
      text: cleaned,
      languageCode: cap.code,
      rate,
      prefetchedVoices: browserVoices,
      onStart: params.onStart,
      onEnd: params.onEnd,
      onError: params.onError,
    });
    if (browserResult.spoken || browserResult.autoplayBlocked) {
      return browserResult;
    }
    browserReason = browserResult.reason;
  }

  // Honest, actionable fallback notice when neither browser nor server produced speech
  const parts = [browserReason, serverReason].filter(Boolean);
  const combinedReason =
    parts.length > 0
      ? `${parts.join(' ')} Install a device ${cap.englishName} voice or configure a server neural/Cloud TTS provider in deployment Secrets.`
      : `Spoken voice is unavailable for ${cap.englishName} on this device; full text response is shown.`;

  params.onEnd?.();
  return {
    spoken: false,
    reason: combinedReason,
  };
}

function attachWaveformAnalyser(
  stream: MediaStream,
  onWaveform?: (bars: number[]) => void,
): () => void {
  if (!onWaveform || typeof window === 'undefined') return () => {};
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return () => {};

  let stopped = false;
  let rafId = 0;
  let ctx: AudioContext | null = null;

  try {
    ctx = new AudioCtx();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      if (stopped) return;
      analyser.getByteFrequencyData(data);
      const bars: number[] = [];
      const barCount = 12;
      const step = Math.max(1, Math.floor(data.length / barCount));
      for (let i = 0; i < barCount; i++) {
        const val = data[i * step] || 0;
        bars.push(Math.max(0.12, Math.min(1, val / 180)));
      }
      onWaveform(bars);
      rafId = window.requestAnimationFrame(tick);
    };
    rafId = window.requestAnimationFrame(tick);
  } catch {
    // Graceful degradation if AudioContext fails
  }

  return () => {
    stopped = true;
    if (rafId) window.cancelAnimationFrame(rafId);
    onWaveform(Array(12).fill(0.15));
    if (ctx && ctx.state !== 'closed') {
      ctx.close().catch(() => {});
    }
  };
}

function pickSupportedRecorderMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm';
  const candidates = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav'];
  for (const mime of candidates) {
    if (typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return 'audio/webm';
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('Failed to encode audio recording.'));
    reader.readAsDataURL(blob);
  });
}

export function startVoiceListening(callbacks: VoiceListeningCallbacks): () => void {
  if (activeListeningCleanup) {
    callbacks.onError(
      'SESSION_ALREADY_ACTIVE',
      'Microphone listening is already active. Please wait or press Stop first.',
    );
    return () => {};
  }

  let cancelled = false;
  let micStream: MediaStream | null = null;
  let stopAnalyser: (() => void) | null = null;
  let innerStopper: (() => void) | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const cleanupAll = () => {
    cancelled = true;
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (innerStopper) {
      const fn = innerStopper;
      innerStopper = null;
      fn();
    }
    if (stopAnalyser) {
      const fn = stopAnalyser;
      stopAnalyser = null;
      fn();
    }
    if (micStream) {
      for (const track of micStream.getTracks()) {
        try {
          track.stop();
        } catch {
          // ignore
        }
      }
      micStream = null;
    }
    if (activeListeningCleanup === cleanupAll) {
      activeListeningCleanup = null;
    }
    callbacks.onStatusChange?.('idle');
  };

  activeListeningCleanup = cleanupAll;

  (async () => {
    try {
      stopAllVoicePlayback();
      callbacks.onStatusChange?.('requesting_mic');

      const caps = detectVoiceCapabilities(callbacks.languageCode);
      if (!caps.microphoneApiAvailable) {
        cleanupAll();
        callbacks.onError(
          'NO_MICROPHONE',
          'Microphone capture is unavailable in this browser. You can type your message below.',
        );
        return;
      }

      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        setSavedVoiceConsent(true);
      } catch (permErr) {
        const errName = permErr instanceof DOMException ? permErr.name : '';
        cleanupAll();
        if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
          callbacks.onError(
            'PERMISSION_DENIED',
            'Microphone access was denied. Allow microphone access in your browser site settings and tap Retry.',
          );
        } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
          callbacks.onError(
            'NO_MICROPHONE',
            'No microphone hardware was detected on this device.',
          );
        } else {
          callbacks.onError(
            'NO_MICROPHONE',
            'Could not access the microphone cleanly. Please check device permissions.',
          );
        }
        return;
      }

      if (cancelled) {
        cleanupAll();
        return;
      }

      stopAnalyser = attachWaveformAnalyser(micStream, callbacks.onWaveform);
      const maxDurationMs = callbacks.maxDurationMs ?? 12000;

      const useBrowserSpeech =
        !callbacks.preferAudioClipCapture &&
        caps.speechRecognitionAvailable &&
        caps.languageCapability.browserSttExpected;

      if (useBrowserSpeech) {
        callbacks.onModeSelected?.('browser_speech');
        callbacks.onStatusChange?.('listening');

        const win = window as unknown as {
          SpeechRecognition?: new () => {
            lang: string;
            interimResults: boolean;
            maxAlternatives: number;
            continuous: boolean;
            onresult: (event: {
              results: ArrayLike<{ isFinal?: boolean } & ArrayLike<{ transcript: string }>>;
            }) => void;
            onerror: (event: { error: string }) => void;
            onend: () => void;
            start: () => void;
            stop: () => void;
          };
          webkitSpeechRecognition?: new () => {
            lang: string;
            interimResults: boolean;
            maxAlternatives: number;
            continuous: boolean;
            onresult: (event: {
              results: ArrayLike<{ isFinal?: boolean } & ArrayLike<{ transcript: string }>>;
            }) => void;
            onerror: (event: { error: string }) => void;
            onend: () => void;
            start: () => void;
            stop: () => void;
          };
        };

        const Ctor = win.SpeechRecognition || win.webkitSpeechRecognition!;
        const recognition = new Ctor();
        const langMeta = getLanguageMeta(callbacks.languageCode);
        recognition.lang = langMeta.bcp47;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        recognition.continuous = false;

        let latestTranscript = '';
        let deliveredFinal = false;

        innerStopper = () => {
          try {
            recognition.stop();
          } catch {
            // ignore
          }
        };

        timeoutId = setTimeout(() => {
          if (!deliveredFinal) {
            cleanupAll();
            if (latestTranscript.trim()) {
              deliveredFinal = true;
              callbacks.onFinalTranscript({
                transcript: latestTranscript.trim(),
                detectedLanguageCode: callbacks.languageCode,
                mode: 'browser_speech',
              });
            } else {
              callbacks.onError(
                'TIMEOUT',
                'Listening timed out before any speech was heard. Tap the microphone and try again.',
              );
            }
          }
        }, maxDurationMs);

        recognition.onresult = (event) => {
          let combined = '';
          let hasFinal = false;
          for (let i = 0; i < event.results.length; i++) {
            const item = event.results[i];
            const text = item?.[0]?.transcript || '';
            combined += text;
            if (item?.isFinal) hasFinal = true;
          }
          latestTranscript = combined.trim();
          if (latestTranscript) {
            callbacks.onInterimTranscript?.(latestTranscript);
          }
          if (hasFinal && latestTranscript && !deliveredFinal) {
            deliveredFinal = true;
            cleanupAll();
            callbacks.onFinalTranscript({
              transcript: latestTranscript,
              detectedLanguageCode: callbacks.languageCode,
              mode: 'browser_speech',
            });
          }
        };

        recognition.onerror = (event) => {
          if (deliveredFinal) return;
          deliveredFinal = true;
          cleanupAll();
          const code = event.error;
          if (code === 'not-allowed' || code === 'service-not-allowed') {
            callbacks.onError(
              'PERMISSION_DENIED',
              'Speech permission was denied. Check microphone settings and try again.',
            );
          } else if (code === 'no-speech') {
            callbacks.onError(
              'EMPTY_SPEECH',
              'No speech was detected. Please speak clearly and try again.',
            );
          } else if (code === 'network') {
            callbacks.onError(
              'NETWORK_ERROR',
              'Network interrupted speech recognition. Please retry or try Audio Clip mode.',
            );
          } else if (code === 'language-not-supported') {
            callbacks.onError(
              'UNSUPPORTED_LANGUAGE',
              `${langMeta.englishName} browser recognition is unavailable; tap Record Audio Clip for neural transcription or use text.`,
            );
          } else if (code !== 'aborted') {
            callbacks.onError('EMPTY_SPEECH', `Voice input stopped (${code}). Please retry.`);
          }
        };

        recognition.onend = () => {
          if (!deliveredFinal && !cancelled) {
            deliveredFinal = true;
            const finalStr = latestTranscript.trim();
            cleanupAll();
            if (finalStr) {
              callbacks.onFinalTranscript({
                transcript: finalStr,
                detectedLanguageCode: callbacks.languageCode,
                mode: 'browser_speech',
              });
            } else {
              callbacks.onError(
                'EMPTY_SPEECH',
                'No speech was captured. Please hold or tap Speak and speak clearly.',
              );
            }
          }
        };

        recognition.start();
        return;
      }

      // Path B: MediaRecorder audio clip -> transient server Gemini 3.5 Transcribe
      if (!caps.mediaRecorderAvailable) {
        cleanupAll();
        callbacks.onError(
          'UNSUPPORTED_LANGUAGE',
          'Speech recognition and audio recording are unavailable in this browser. Text input remains active.',
        );
        return;
      }

      callbacks.onModeSelected?.('neural_audio');
      callbacks.onStatusChange?.('listening');

      const mimeType = pickSupportedRecorderMimeType();
      const recorder = new MediaRecorder(micStream, { mimeType });
      const chunks: Blob[] = [];
      let stopRequested = false;

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data);
      };

      recorder.onstop = async () => {
        if (cancelled && !stopRequested) {
          return;
        }
        const blob = new Blob(chunks, { type: mimeType });
        if (blob.size < 250) {
          cleanupAll();
          callbacks.onError('EMPTY_SPEECH', 'Recording was too short. Please speak a bit longer.');
          return;
        }

        try {
          callbacks.onStatusChange?.('processing');
          const token = await getAuthenticatedIdToken();
          if (!token) {
            throw new Error('Authentication required for neural speech transcription.');
          }
          const audioBase64 = await blobToBase64(blob);
          const res = await fetch(buildApiUrl('/api/v1/voice/transcribe'), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              audioBase64,
              mimeType,
              preferredLanguage: callbacks.languageCode,
              autoDetect: callbacks.autoDetectLanguage ?? true,
            }),
          });
          const data = (await res.json()) as {
            ok: boolean;
            transcript?: string;
            detectedLanguageCode?: string;
            code?: string;
            error?: string;
          };
          cleanupAll();
          if (!res.ok || !data.ok || !data.transcript) {
            if (data.code === 'EMPTY_SPEECH') {
              callbacks.onError(
                'EMPTY_SPEECH',
                data.error || 'No intelligible speech detected in audio clip.',
              );
            } else {
              callbacks.onError(
                res.status === 503 ? 'TRANSCRIPTION_UNAVAILABLE' : 'NETWORK_ERROR',
                data.error || 'Could not transcribe audio clip.',
              );
            }
            return;
          }
          callbacks.onFinalTranscript({
            transcript: data.transcript,
            detectedLanguageCode: data.detectedLanguageCode || callbacks.languageCode,
            mode: 'neural_audio',
          });
        } catch (err) {
          cleanupAll();
          callbacks.onError(
            'NETWORK_ERROR',
            err instanceof Error ? err.message : 'Failed to transcribe recording.',
          );
        }
      };

      innerStopper = () => {
        stopRequested = true;
        if (recorder.state === 'recording') {
          try {
            recorder.stop();
          } catch {
            // ignore
          }
        }
      };

      timeoutId = setTimeout(() => {
        if (recorder.state === 'recording') {
          stopRequested = true;
          recorder.stop();
        }
      }, maxDurationMs);

      recorder.start(250);
    } catch (err) {
      cleanupAll();
      callbacks.onError(
        'NETWORK_ERROR',
        err instanceof Error ? err.message : 'Unexpected voice session failure.',
      );
    }
  })();

  return cleanupAll;
}

export function listenForVoiceCommand(
  languageCode: string,
  onTranscript: (text: string) => void,
  onError: (message: string) => void,
): () => void {
  return startVoiceListening({
    languageCode,
    onFinalTranscript: ({ transcript }) => onTranscript(transcript),
    onError: (_code, message) => onError(message),
  });
}

export { VOICE_LANGUAGE_MATRIX };
