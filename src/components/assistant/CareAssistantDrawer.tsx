import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Globe,
  Mic,
  MicOff,
  Play,
  RotateCcw,
  Send,
  ShieldAlert,
  Square,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  getVoiceLanguageCapability,
  VOICE_LANGUAGE_MATRIX,
} from '../../../shared/voiceLanguageMatrix.ts';
import { useCareBridge } from '../../context/CareBridgeContext.tsx';
import { getAuthenticatedIdToken } from '../../services/firestoreService.ts';
import {
  detectVoiceCapabilities,
  fetchServerVoiceCapabilities,
  getBrowserVoiceInventorySummary,
  getMicrophonePermissionState,
  getSavedVoiceConsent,
  getServerVoiceCapabilitiesSnapshot,
  getVoiceSpeechRate,
  playCachedAudioBuffer,
  refreshBrowserVoices,
  setSavedVoiceConsent,
  setVoiceSpeechRate,
  speakTextWithFallback,
  startVoiceListening,
  stopActiveListening,
  stopAllVoicePlayback,
  subscribeVoiceListChanged,
  unlockMobileAudioPlayback,
  type CachedAudioPayload,
  type MicrophonePermissionState,
  type ServerVoiceCapabilities,
} from '../../services/voiceService.ts';

interface PendingActionState {
  actionType: 'log_dose' | 'notify_caregiver_missed' | 'change_language';
  groupId?: string;
  label: string;
  summary: string;
  payload: Record<string, unknown>;
}

interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  spokenText?: string;
  languageCode: string;
  dir: 'ltr' | 'rtl';
  intent?: string;
  navigateTo?: string;
  requiresConfirmation?: boolean;
  pendingAction?: PendingActionState;
  actionResolved?: 'confirmed' | 'cancelled';
  emergencyNotice?: boolean;
  audioStatus?: 'idle' | 'playing' | 'played' | 'autoplay_blocked' | 'text_only';
  audioNotice?: string;
  cachedAudio?: CachedAudioPayload;
}

export const CareAssistantDrawer: React.FC<{
  open: boolean;
  onClose: () => void;
}> = ({ open, onClose }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    activeGroupId,
    languageCode,
    setLanguageAndScript,
    accessibility,
  } = useCareBridge();

  const [conversationLang, setConversationLang] = useState(languageCode);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [speechRate, setSpeechRateState] = useState<number>(() => getVoiceSpeechRate());
  const [micPermission, setMicPermission] = useState<MicrophonePermissionState>('prompt');
  const [consentGiven, setConsentGiven] = useState<boolean>(() => getSavedVoiceConsent());
  const [listenStatus, setListenStatus] = useState<
    'idle' | 'requesting_mic' | 'listening' | 'processing'
  >('idle');
  const [listenMode, setListenMode] = useState<'browser_speech' | 'neural_audio' | null>(null);
  const [preferAudioClip, setPreferAudioClip] = useState(false);
  const [waveform, setWaveform] = useState<number[]>(() => Array(12).fill(0.15));
  const [interimTranscript, setInterimTranscript] = useState('');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceListEpoch, setVoiceListEpoch] = useState(0);
  const [serverCaps, setServerCaps] = useState<ServerVoiceCapabilities>(() =>
    getServerVoiceCapabilitiesSnapshot(),
  );
  const [lastSpokenText, setLastSpokenText] = useState<{
    turnId: string;
    text: string;
    languageCode: string;
  } | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: 'Hello! Ask me with your voice or text in 23 languages: "Which medicine should I take next?", "Show my upcoming appointments", or "Change my preferred language to Kannada".',
      languageCode: 'en',
      dir: 'ltr',
    },
  ]);

  const scrollEndRef = useRef<HTMLDivElement | null>(null);
  const turnsRef = useRef<ChatTurn[]>(turns);
  turnsRef.current = turns;

  const langCapability = useMemo(
    () => getVoiceLanguageCapability(conversationLang),
    [conversationLang],
  );
  const browserCaps = useMemo(
    () => detectVoiceCapabilities(conversationLang),
    [conversationLang, voiceListEpoch],
  );
  const voiceInventory = useMemo(
    () => getBrowserVoiceInventorySummary(conversationLang),
    [conversationLang, voiceListEpoch],
  );

  useEffect(() => {
    setConversationLang(languageCode);
  }, [languageCode]);

  useEffect(() => {
    return subscribeVoiceListChanged(() => {
      setVoiceListEpoch((prev) => prev + 1);
    });
  }, []);

  useEffect(() => {
    if (!open) {
      stopActiveListening();
      stopAllVoicePlayback();
      setListenStatus('idle');
      setIsSpeaking(false);
      return;
    }
    getMicrophonePermissionState().then(setMicPermission).catch(() => {});
    refreshBrowserVoices().then(() => setVoiceListEpoch((prev) => prev + 1)).catch(() => {});
    fetchServerVoiceCapabilities().then(setServerCaps).catch(() => {});
  }, [open]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        stopActiveListening();
        stopAllVoicePlayback();
        setListenStatus('idle');
        setIsSpeaking(false);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      stopActiveListening();
      stopAllVoicePlayback();
    };
  }, []);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({
      behavior: accessibility.reducedMotion ? 'auto' : 'smooth',
    });
  }, [turns, interimTranscript, loading, accessibility.reducedMotion]);

  const updateTurnAudioState = useCallback(
    (
      turnId: string,
      patch: Partial<Pick<ChatTurn, 'audioStatus' | 'audioNotice' | 'cachedAudio'>>,
    ) => {
      setTurns((prev) =>
        prev.map((item) => (item.id === turnId ? { ...item, ...patch } : item)),
      );
    },
    [],
  );

  const speakTurnResponse = useCallback(
    async (turnId: string, text: string, targetLangCode: string, rateOverride?: number) => {
      setLastSpokenText({ turnId, text, languageCode: targetLangCode });
      setVoiceError(null);
      updateTurnAudioState(turnId, { audioStatus: 'idle', audioNotice: undefined });

      const res = await speakTextWithFallback({
        text,
        languageCode: targetLangCode,
        rate: rateOverride ?? speechRate,
        onStart: () => {
          setIsSpeaking(true);
          updateTurnAudioState(turnId, { audioStatus: 'playing', audioNotice: undefined });
        },
        onEnd: () => {
          setIsSpeaking(false);
        },
        onError: (msg) => {
          setIsSpeaking(false);
          updateTurnAudioState(turnId, {
            audioStatus: 'text_only',
            audioNotice: msg,
          });
        },
      });

      if (res.spoken) {
        updateTurnAudioState(turnId, {
          audioStatus: 'played',
          audioNotice: undefined,
          cachedAudio: undefined,
        });
      } else if (res.autoplayBlocked) {
        setIsSpeaking(false);
        updateTurnAudioState(turnId, {
          audioStatus: 'autoplay_blocked',
          audioNotice: res.reason,
          cachedAudio: res.cachedAudio,
        });
      } else if (res.reason && !res.reason.includes('stopped')) {
        setIsSpeaking(false);
        updateTurnAudioState(turnId, {
          audioStatus: 'text_only',
          audioNotice: res.reason,
        });
      } else {
        setIsSpeaking(false);
      }
    },
    [speechRate, updateTurnAudioState],
  );

  const handlePlayCachedTurnAudio = async (turn: ChatTurn) => {
    unlockMobileAudioPlayback();
    if (!turn.cachedAudio) {
      await speakTurnResponse(turn.id, turn.spokenText || turn.text, turn.languageCode);
      return;
    }

    const res = await playCachedAudioBuffer({
      cachedAudio: { ...turn.cachedAudio, rate: speechRate },
      onStart: () => {
        setIsSpeaking(true);
        updateTurnAudioState(turn.id, { audioStatus: 'playing', audioNotice: undefined });
      },
      onEnd: () => setIsSpeaking(false),
      onError: (msg) => {
        setIsSpeaking(false);
        updateTurnAudioState(turn.id, { audioStatus: 'text_only', audioNotice: msg });
      },
    });

    if (res.spoken) {
      updateTurnAudioState(turn.id, {
        audioStatus: 'played',
        audioNotice: undefined,
        cachedAudio: undefined,
      });
    }
  };

  const submitUserMessage = useCallback(
    async (rawText: string, detectedLangOverride?: string) => {
      const cleaned = rawText.trim();
      if (!cleaned || loading) return;

      const effectiveLang = detectedLangOverride || conversationLang;
      const cap = getVoiceLanguageCapability(effectiveLang);

      const userTurn: ChatTurn = {
        id: `u_${Date.now()}`,
        role: 'user',
        text: cleaned,
        languageCode: effectiveLang,
        dir: cap.defaultDir,
      };

      setTurns((prev) => [...prev, userTurn]);
      setInput('');
      setInterimTranscript('');
      setVoiceError(null);
      setLoading(true);

      try {
        const token = await getAuthenticatedIdToken();
        if (!token) {
          throw new Error('Please sign in first to use CareBridge Voice Assistant.');
        }

        const recentHistory = turnsRef.current
          .filter((item) => item.id !== 'welcome')
          .slice(-6)
          .map((item) => ({ role: item.role, text: item.text }));

        const res = await fetch('/api/v1/voice/converse', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            transcript: cleaned,
            preferredLanguage: conversationLang,
            autoDetectLanguage: true,
            groupId: activeGroupId || undefined,
            history: recentHistory,
          }),
        });

        const data = (await res.json()) as {
          ok: boolean;
          error?: string;
          replyText?: string;
          spokenText?: string;
          responseLanguageCode?: string;
          direction?: 'ltr' | 'rtl';
          intent?: string;
          navigateTo?: string;
          requiresConfirmation?: boolean;
          pendingAction?: PendingActionState;
          emergencyNotice?: boolean;
        };

        if (!res.ok || !data.ok || !data.replyText) {
          throw new Error(data.error || 'Voice assistant could not process your request.');
        }

        const turnId = `a_${Date.now()}`;
        const assistantTurn: ChatTurn = {
          id: turnId,
          role: 'assistant',
          text: data.replyText,
          spokenText: data.spokenText || data.replyText,
          languageCode: data.responseLanguageCode || conversationLang,
          dir: data.direction || cap.defaultDir,
          intent: data.intent,
          navigateTo: data.navigateTo,
          requiresConfirmation: data.requiresConfirmation,
          pendingAction: data.pendingAction,
          emergencyNotice: data.emergencyNotice,
        };

        setTurns((prev) => [...prev, assistantTurn]);

        if (data.intent === 'navigate' && data.navigateTo) {
          navigate(data.navigateTo);
        }

        if (autoSpeak) {
          await speakTurnResponse(
            turnId,
            assistantTurn.spokenText || assistantTurn.text,
            assistantTurn.languageCode,
          );
        } else {
          setLastSpokenText({
            turnId,
            text: assistantTurn.spokenText || assistantTurn.text,
            languageCode: assistantTurn.languageCode,
          });
        }
      } catch (err) {
        setVoiceError(
          err instanceof Error ? err.message : 'Network error reaching voice assistant.',
        );
      } finally {
        setLoading(false);
      }
    },
    [loading, conversationLang, activeGroupId, navigate, autoSpeak, speakTurnResponse],
  );

  const handleConfirmPendingAction = async (turnId: string, action: PendingActionState) => {
    unlockMobileAudioPlayback();
    setVoiceError(null);
    setLoading(true);
    try {
      const token = await getAuthenticatedIdToken();
      if (!token) throw new Error('Authentication required.');

      const res = await fetch('/api/v1/voice/execute-action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          confirmed: true,
          actionType: action.actionType,
          groupId: action.groupId || activeGroupId || undefined,
          payload: action.payload,
        }),
      });

      const data = (await res.json()) as {
        ok: boolean;
        summary?: string;
        updatedLanguageCode?: string;
        updatedScript?: string;
        error?: string;
      };

      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Could not complete confirmed action.');
      }

      if (data.updatedLanguageCode) {
        setConversationLang(data.updatedLanguageCode);
        await setLanguageAndScript(data.updatedLanguageCode, data.updatedScript);
      }

      const confirmLang = data.updatedLanguageCode || conversationLang;
      const confirmCap = getVoiceLanguageCapability(confirmLang);
      const resultText = data.summary || 'Action completed.';
      const confirmTurnId = `c_${Date.now()}`;

      setTurns((prev) => [
        ...prev.map((item) =>
          item.id === turnId ? { ...item, actionResolved: 'confirmed' as const } : item,
        ),
        {
          id: confirmTurnId,
          role: 'assistant',
          text: resultText,
          languageCode: confirmLang,
          dir: confirmCap.defaultDir,
        },
      ]);

      if (autoSpeak) {
        await speakTurnResponse(confirmTurnId, resultText, confirmLang);
      }
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : 'Confirmed action failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelPendingAction = (turnId: string) => {
    setTurns((prev) => [
      ...prev.map((item) =>
        item.id === turnId ? { ...item, actionResolved: 'cancelled' as const } : item,
      ),
      {
        id: `x_${Date.now()}`,
        role: 'assistant',
        text: 'Cancelled. No changes were made.',
        languageCode: conversationLang,
        dir: langCapability.defaultDir,
      },
    ]);
  };

  const handleStartListening = () => {
    unlockMobileAudioPlayback();
    setVoiceError(null);
    setInterimTranscript('');
    if (!consentGiven) {
      setSavedVoiceConsent(true);
      setConsentGiven(true);
    }

    startVoiceListening({
      languageCode: conversationLang,
      autoDetectLanguage: true,
      preferAudioClipCapture: preferAudioClip,
      onModeSelected: (m) => setListenMode(m),
      onStatusChange: (status) => {
        setListenStatus(status);
        if (status === 'listening') {
          setMicPermission('granted');
        }
      },
      onWaveform: (bars) => {
        if (!accessibility.reducedMotion) {
          setWaveform(bars);
        }
      },
      onInterimTranscript: (partial) => setInterimTranscript(partial),
      onFinalTranscript: ({ transcript, detectedLanguageCode }) => {
        setListenStatus('idle');
        setInterimTranscript('');
        submitUserMessage(transcript, detectedLanguageCode);
      },
      onError: (code, msg) => {
        setListenStatus('idle');
        if (code === 'PERMISSION_DENIED') {
          setMicPermission('denied');
        }
        setVoiceError(msg);
      },
    });
  };

  const handleStopListening = () => {
    stopActiveListening();
    setListenStatus('idle');
  };

  const handleChangeSpeechRate = (rate: number) => {
    setSpeechRateState(rate);
    setVoiceSpeechRate(rate);
  };

  if (!open) return null;

  const isListeningNow = listenStatus === 'listening' || listenStatus === 'requesting_mic';

  return (
    <div
      className="fixed inset-0 z-50 bg-[#3E0911]/40 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={t('topbar.assistantButton')}
    >
      <div className="w-full max-w-full sm:max-w-lg bg-[#FAF7F2] h-full shadow-2xl border-l border-[#3E0911]/15 flex flex-col overflow-x-hidden">
        {/* Header */}
        <div className="p-4 sm:p-5 bg-[#383C23] text-[#FAF7F2] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Mic className="w-5 h-5 text-[#D7CAB7] shrink-0" />
              <h2 className="font-bold text-base truncate">{t('topbar.assistantButton')}</h2>
            </div>
            <p className="text-xs text-[#E5DDD0]/90 mt-0.5 truncate">
              {langCapability.nativeName} ({langCapability.englishName}) · {langCapability.bcp47}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              stopActiveListening();
              stopAllVoicePlayback();
              onClose();
            }}
            aria-label={t('common.close')}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl hover:bg-white/10 text-[#FAF7F2] cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Non-diagnostic Safety Banner */}
        <div className="px-4 py-2.5 bg-[#F6EAEC] border-b border-[#85383E]/20 flex items-start gap-2 text-xs text-[#3E0911]">
          <ShieldAlert className="w-4 h-4 text-[#85383E] shrink-0 mt-0.5" />
          <span>{t('brand.disclaimer')}</span>
        </div>

        {/* Mid-Conversation Language Switcher & Honest Capability Note */}
        <div className="px-4 py-3 bg-white border-b border-[#3E0911]/10 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#3E0911]">
              <Globe className="w-4 h-4 text-[#71774B]" />
              <span>Voice Language:</span>
            </label>
            <select
              aria-label="Conversation voice language"
              value={conversationLang}
              onChange={(e) => setConversationLang(e.target.value)}
              className="min-h-[44px] px-3 py-2 rounded-xl border border-[#3E0911]/20 bg-[#FAF7F2] text-sm font-medium text-[#3E0911] max-w-full"
            >
              {VOICE_LANGUAGE_MATRIX.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.nativeName} ({lang.englishName})
                </option>
              ))}
            </select>
          </div>

          <div className="text-xs text-[#5D4A44]">{langCapability.capabilityNote}</div>

          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/10 text-xs">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[#5D4A44] min-w-0">
              <span>
                Voice:{' '}
                <strong className={browserCaps.hasVoiceForLanguage ? 'text-[#383C23]' : 'text-[#85383E]'}>
                  {voiceInventory.preferredVoice
                    ? `${voiceInventory.preferredVoice.name} (${voiceInventory.preferredVoice.lang})`
                    : serverCaps.serverTtsAvailable
                      ? 'Server Neural/Cloud TTS ready'
                      : browserCaps.speechSynthesisAvailable
                        ? `No ${langCapability.englishName} browser voice`
                        : 'Text only on this browser'}
                </strong>
              </span>
              {serverCaps.checked && (
                <span className="text-[#5D4A44]">
                  · Server TTS:{' '}
                  <strong>{serverCaps.serverTtsAvailable ? 'Active' : 'Not configured'}</strong>
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                refreshBrowserVoices()
                  .then(() => setVoiceListEpoch((prev) => prev + 1))
                  .catch(() => {});
                fetchServerVoiceCapabilities(true).then(setServerCaps).catch(() => {});
              }}
              className="min-h-[44px] px-2.5 py-1.5 rounded-lg text-xs font-semibold text-[#71774B] hover:text-[#383C23] cursor-pointer"
            >
              Refresh Voices
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
            <div className="inline-flex items-center gap-1 bg-[#FAF7F2] p-1 rounded-xl border border-[#3E0911]/10">
              <span className="text-xs font-semibold text-[#5D4A44] px-1.5">Speed:</span>
              {[
                { label: '0.8x', val: 0.8 },
                { label: '0.95x', val: 0.95 },
                { label: '1.15x', val: 1.15 },
              ].map((opt) => (
                <button
                  key={opt.val}
                  type="button"
                  onClick={() => handleChangeSpeechRate(opt.val)}
                  className={`min-h-[38px] px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer ${
                    Math.abs(speechRate - opt.val) < 0.05
                      ? 'bg-[#71774B] text-white'
                      : 'text-[#3E0911] hover:bg-[#E5DDD0]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setAutoSpeak((v) => !v)}
                className={`min-h-[44px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer ${
                  autoSpeak
                    ? 'bg-[#71774B]/15 border-[#71774B] text-[#383C23]'
                    : 'bg-[#FAF7F2] border-[#3E0911]/15 text-[#5D4A44]'
                }`}
              >
                {autoSpeak ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                <span>{autoSpeak ? 'Spoken Replies On' : 'Text Only'}</span>
              </button>

              {browserCaps.mediaRecorderAvailable && browserCaps.speechRecognitionAvailable && (
                <button
                  type="button"
                  onClick={() => setPreferAudioClip((v) => !v)}
                  className={`min-h-[44px] px-3 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer ${
                    preferAudioClip
                      ? 'bg-[#383C23] text-white border-[#383C23]'
                      : 'bg-[#FAF7F2] text-[#5D4A44] border-[#3E0911]/15'
                  }`}
                  title="Switch between instant browser recognition and recorded audio clip transcription"
                >
                  {preferAudioClip ? 'Audio Clip Mode' : 'Live Speech Mode'}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Microphone Permission & Privacy Notice */}
        {!consentGiven && micPermission !== 'granted' && (
          <div className="mx-4 mt-3 p-3.5 rounded-xl bg-white border border-[#71774B]/30 text-sm text-[#3E0911] flex flex-col gap-2">
            <div className="font-semibold">Microphone Privacy & Consent</div>
            <p className="text-xs text-[#5D4A44] leading-relaxed">
              CareBridge only listens while Speak is active. Audio is never saved or stored after
              understanding your command.
            </p>
            <button
              type="button"
              onClick={() => {
                unlockMobileAudioPlayback();
                setSavedVoiceConsent(true);
                setConsentGiven(true);
              }}
              className="self-start min-h-[44px] px-4 py-2 rounded-xl bg-[#71774B] text-white text-sm font-semibold cursor-pointer"
            >
              Allow Voice Interaction
            </button>
          </div>
        )}

        {/* Conversation Feed */}
        <div
          className="flex-1 overflow-y-auto p-4 space-y-3"
          aria-live="polite"
          aria-relevant="additions"
        >
          {turns.map((turn) => (
            <div
              key={turn.id}
              dir={turn.dir}
              className={`p-4 rounded-2xl text-[15px] leading-relaxed space-y-2.5 ${
                turn.role === 'user'
                  ? 'bg-[#71774B] text-white ml-6 sm:ml-8'
                  : turn.emergencyNotice
                    ? 'bg-[#F6EAEC] border-2 border-[#85383E] text-[#3E0911] mr-3 sm:mr-4'
                    : 'bg-white border border-[#3E0911]/10 text-[#3E0911] mr-3 sm:mr-4'
              }`}
            >
              {turn.emergencyNotice && (
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#85383E]">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Emergency Assistance Guidance</span>
                </div>
              )}

              <div>{turn.text}</div>

              {turn.role === 'assistant' && turn.id !== 'welcome' && (
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  {turn.audioStatus === 'autoplay_blocked' ? (
                    <button
                      type="button"
                      onClick={() => handlePlayCachedTurnAudio(turn)}
                      className="cb-btn-3d min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#383C23] hover:bg-[#2A2D1A] text-white text-sm font-bold cursor-pointer"
                    >
                      <Play className="w-4 h-4 fill-current" />
                      <span>Tap to Play Audio</span>
                    </button>
                  ) : turn.audioStatus === 'playing' && isSpeaking ? (
                    <button
                      type="button"
                      onClick={() => {
                        stopAllVoicePlayback();
                        setIsSpeaking(false);
                        updateTurnAudioState(turn.id, { audioStatus: 'idle' });
                      }}
                      className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#85383E] text-white text-sm font-semibold cursor-pointer"
                    >
                      <Square className="w-3.5 h-3.5 fill-current" />
                      <span>Stop Audio</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        unlockMobileAudioPlayback();
                        speakTurnResponse(
                          turn.id,
                          turn.spokenText || turn.text,
                          turn.languageCode,
                        );
                      }}
                      className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/15 hover:bg-[#E5DDD0] text-[#3E0911] text-sm font-semibold cursor-pointer"
                    >
                      {turn.audioStatus === 'text_only' ? (
                        <RotateCcw className="w-4 h-4 text-[#85383E]" />
                      ) : (
                        <Volume2 className="w-4 h-4 text-[#71774B]" />
                      )}
                      <span>{turn.audioStatus === 'text_only' ? 'Retry Audio' : 'Play Audio'}</span>
                    </button>
                  )}

                  {turn.audioNotice && (
                    <span className="text-xs text-[#85383E]" role="status">
                      {turn.audioNotice}
                    </span>
                  )}
                </div>
              )}

              {turn.role === 'assistant' && turn.navigateTo && turn.intent !== 'navigate' && (
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      navigate(turn.navigateTo!);
                      onClose();
                    }}
                    className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/15 hover:bg-[#E5DDD0] text-sm font-semibold text-[#3E0911] cursor-pointer"
                  >
                    Open {turn.navigateTo.replace('/', '') || 'Dashboard'}
                  </button>
                </div>
              )}

              {turn.requiresConfirmation && turn.pendingAction && !turn.actionResolved && (
                <div className="p-3.5 rounded-xl bg-[#FAF7F2] border border-[#71774B]/40 space-y-2">
                  <div className="text-sm font-bold text-[#383C23]">
                    {turn.pendingAction.label}
                  </div>
                  <div className="text-sm text-[#5D4A44]">{turn.pendingAction.summary}</div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => handleConfirmPendingAction(turn.id, turn.pendingAction!)}
                      className="cb-btn-3d min-h-[44px] inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#71774B] hover:bg-[#5E633D] disabled:opacity-50 text-white text-sm font-bold cursor-pointer"
                    >
                      <Check className="w-4 h-4" />
                      Confirm
                    </button>
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => handleCancelPendingAction(turn.id)}
                      className="min-h-[44px] inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white border border-[#3E0911]/20 hover:bg-[#E5DDD0] text-[#3E0911] text-sm font-semibold cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {turn.actionResolved && (
                <div className="text-xs font-semibold text-[#71774B]">
                  {turn.actionResolved === 'confirmed' ? 'Confirmed & applied' : 'Cancelled'}
                </div>
              )}
            </div>
          ))}

          {interimTranscript && (
            <div
              className="p-3.5 rounded-2xl bg-[#71774B]/20 border border-[#71774B]/40 text-sm text-[#3E0911] ml-6 sm:ml-8 italic"
              aria-live="assertive"
            >
              Listening: &ldquo;{interimTranscript}&rdquo;
            </div>
          )}

          {loading && (
            <div className="p-3.5 rounded-2xl bg-white border border-[#3E0911]/10 text-sm text-[#5D4A44] mr-4">
              {t('common.loading')}
            </div>
          )}

          <div ref={scrollEndRef} />
        </div>

        {/* Live Listening Indicator, Waveform & Playback Controls */}
        <div className="px-4 py-3 bg-[#FAF7F2] border-t border-[#3E0911]/10 space-y-2.5">
          {voiceError && (
            <div
              role="alert"
              className="p-3 rounded-xl bg-[#F6EAEC] border border-[#85383E]/30 text-sm text-[#85383E] flex flex-wrap items-center justify-between gap-2"
            >
              <span>{voiceError}</span>
              <button
                type="button"
                onClick={handleStartListening}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-[#85383E]/30 text-sm text-[#3E0911] font-semibold shrink-0 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                Retry
              </button>
            </div>
          )}

          {isListeningNow && (
            <div className="p-3 rounded-xl bg-[#383C23] text-[#FAF7F2] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full bg-[#D7CAB7] animate-pulse shrink-0" />
                <span className="text-sm font-semibold truncate">
                  {listenStatus === 'requesting_mic'
                    ? 'Opening microphone...'
                    : listenMode === 'neural_audio'
                      ? `Recording ${langCapability.englishName} audio clip... Tap Stop when finished`
                      : `Listening in ${langCapability.nativeName}...`}
                </span>
              </div>

              <div className="flex items-center gap-1 h-6 shrink-0" aria-hidden="true">
                {waveform.map((level, idx) => (
                  <span
                    key={idx}
                    className="w-1 rounded-full bg-[#D7CAB7] transition-all duration-75"
                    style={{
                      height: `${Math.max(4, Math.round((accessibility.reducedMotion ? 0.45 : level) * 24))}px`,
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {listenStatus === 'processing' && (
            <div className="p-3 rounded-xl bg-white border border-[#71774B]/30 text-sm font-medium text-[#383C23]">
              Transcribing speech in {langCapability.nativeName}...
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {!isListeningNow ? (
              <button
                type="button"
                disabled={loading || listenStatus === 'processing'}
                onClick={handleStartListening}
                className="cb-btn-3d flex-1 min-h-[48px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#383C23] hover:bg-[#2A2D1A] disabled:opacity-50 text-white text-[15px] font-bold cursor-pointer"
              >
                {micPermission === 'denied' ? (
                  <MicOff className="w-4 h-4" />
                ) : (
                  <Mic className="w-4 h-4" />
                )}
                <span>Speak ({langCapability.nativeName})</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStopListening}
                className="cb-btn-3d flex-1 min-h-[48px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#85383E] hover:bg-[#6D2B30] text-white text-[15px] font-bold cursor-pointer"
              >
                <Square className="w-4 h-4 fill-current" />
                <span>Stop Listening</span>
              </button>
            )}

            {isSpeaking ? (
              <button
                type="button"
                onClick={() => {
                  stopAllVoicePlayback();
                  setIsSpeaking(false);
                }}
                className="min-h-[48px] inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#85383E] text-white text-sm font-bold cursor-pointer"
                aria-label="Stop speaking"
              >
                <VolumeX className="w-4 h-4" />
                <span>Stop Audio</span>
              </button>
            ) : (
              lastSpokenText && (
                <button
                  type="button"
                  onClick={() => {
                    unlockMobileAudioPlayback();
                    speakTurnResponse(
                      lastSpokenText.turnId,
                      lastSpokenText.text,
                      lastSpokenText.languageCode,
                    );
                  }}
                  className="min-h-[48px] inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white border border-[#3E0911]/20 hover:bg-[#E5DDD0] text-[#3E0911] text-sm font-semibold cursor-pointer"
                  aria-label="Repeat response"
                >
                  <RotateCcw className="w-4 h-4 text-[#71774B]" />
                  <span>Repeat</span>
                </button>
              )
            )}
          </div>
        </div>

        {/* Text Input Fallback */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            unlockMobileAudioPlayback();
            submitUserMessage(input);
          }}
          className="p-3.5 pb-safe bg-white border-t border-[#3E0911]/10 flex gap-2"
        >
          <input
            type="text"
            dir={langCapability.defaultDir}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Type in ${langCapability.nativeName} or English...`}
            className="flex-1 min-h-[44px] px-3.5 py-2.5 rounded-xl border border-[#3E0911]/20 bg-[#FAF7F2] text-base text-[#3E0911]"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="cb-btn-3d min-w-[48px] min-h-[44px] px-4 py-2.5 rounded-xl bg-[#71774B] hover:bg-[#5E633D] disabled:opacity-50 text-white cursor-pointer flex items-center justify-center"
            aria-label="Send"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
