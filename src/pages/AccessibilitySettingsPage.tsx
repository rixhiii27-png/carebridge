import React, { useEffect, useMemo, useState } from 'react';
import { Eye, Globe, Mic, RotateCcw, ShieldCheck, Square, Volume2, VolumeX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { VOICE_LANGUAGE_MATRIX } from '../../shared/voiceLanguageMatrix.ts';
import { PageHeader } from '../components/common/AccessibleWidgets.tsx';
import { buildApiUrl } from '../config/api.ts';
import { useCareBridge } from '../context/CareBridgeContext.tsx';
import { getAuthenticatedIdToken } from '../services/firestoreService.ts';
import {
  detectVoiceCapabilities,
  fetchServerVoiceCapabilities,
  getBrowserVoiceInventorySummary,
  getServerVoiceCapabilitiesSnapshot,
  getVoiceSpeechRate,
  refreshBrowserVoices,
  setVoiceSpeechRate,
  speakTextWithFallback,
  startVoiceListening,
  stopActiveListening,
  stopAllVoicePlayback,
  subscribeVoiceListChanged,
  unlockMobileAudioPlayback,
  type ServerVoiceCapabilities,
} from '../services/voiceService.ts';

export const AccessibilitySettingsPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { accessibility, updateAccessibility, languageCode, activeGroupId } = useCareBridge();

  const [transcript, setTranscript] = useState<string | null>(null);
  const [voiceReply, setVoiceReply] = useState<string | null>(null);
  const [ttsError, setTtsError] = useState<string | null>(null);
  const [sttError, setSttError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [speechRate, setSpeechRateState] = useState<number>(() => getVoiceSpeechRate());
  const [showMatrix, setShowMatrix] = useState(true);
  const [voiceListEpoch, setVoiceListEpoch] = useState(0);
  const [serverCaps, setServerCaps] = useState<ServerVoiceCapabilities>(() =>
    getServerVoiceCapabilitiesSnapshot(),
  );

  const caps = useMemo(
    () => detectVoiceCapabilities(languageCode),
    [languageCode, voiceListEpoch],
  );
  const inventory = useMemo(
    () => getBrowserVoiceInventorySummary(languageCode),
    [languageCode, voiceListEpoch],
  );

  useEffect(() => {
    const unsubVoices = subscribeVoiceListChanged(() => {
      setVoiceListEpoch((prev) => prev + 1);
    });
    refreshBrowserVoices().then(() => setVoiceListEpoch((prev) => prev + 1)).catch(() => {});
    fetchServerVoiceCapabilities().then(setServerCaps).catch(() => {});
    return () => {
      unsubVoices();
      stopActiveListening();
      stopAllVoicePlayback();
    };
  }, []);

  const handleTestSpeech = async () => {
    unlockMobileAudioPlayback();
    if (speaking) {
      stopAllVoicePlayback();
      setSpeaking(false);
      return;
    }
    setTtsError(null);
    const res = await speakTextWithFallback({
      text: `${t('brand.name')}. ${t('dashboard.todayOverview')}.`,
      languageCode,
      rate: speechRate,
      onStart: () => setSpeaking(true),
      onEnd: () => setSpeaking(false),
      onError: () => setSpeaking(false),
    });
    if (!res.spoken) {
      setSpeaking(false);
      setTtsError(res.reason || t('accessibility.voiceUnavailable'));
    }
  };

  const handleVoiceNavigate = () => {
    unlockMobileAudioPlayback();
    if (listening) {
      stopActiveListening();
      setListening(false);
      return;
    }

    setSttError(null);
    setVoiceReply(null);
    startVoiceListening({
      languageCode,
      autoDetectLanguage: true,
      onStatusChange: (s) => setListening(s === 'listening' || s === 'requesting_mic'),
      onFinalTranscript: async ({ transcript: text }) => {
        setListening(false);
        setTranscript(text);

        try {
          const token = await getAuthenticatedIdToken();
          if (!token) throw new Error('Authentication required.');
          const res = await fetch(buildApiUrl('/api/v1/voice/converse'), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              transcript: text,
              preferredLanguage: languageCode,
              autoDetectLanguage: true,
              groupId: activeGroupId || undefined,
              history: [],
            }),
          });
          const data = (await res.json()) as {
            ok: boolean;
            replyText?: string;
            responseLanguageCode?: string;
            navigateTo?: string;
            error?: string;
          };
          if (!res.ok || !data.ok) {
            throw new Error(data.error || 'Voice command could not be processed.');
          }
          if (data.replyText) {
            setVoiceReply(data.replyText);
            const speakRes = await speakTextWithFallback({
              text: data.replyText,
              languageCode: data.responseLanguageCode || languageCode,
              rate: speechRate,
              onStart: () => setSpeaking(true),
              onEnd: () => setSpeaking(false),
              onError: () => setSpeaking(false),
            });
            if (!speakRes.spoken && speakRes.reason) {
              setTtsError(speakRes.reason);
            }
          }
          if (data.navigateTo) {
            navigate(data.navigateTo);
          }
        } catch (err) {
          setSttError(err instanceof Error ? err.message : 'Voice command failed.');
        }
      },
      onError: (_code, msg) => {
        setListening(false);
        setSttError(msg);
      },
    });
  };

  const handleRateChange = (rate: number) => {
    setSpeechRateState(rate);
    setVoiceSpeechRate(rate);
  };

  const toggles = [
    {
      key: 'largeText' as const,
      label: t('accessibility.largeText'),
      hint: 'Increases reading size across cards, schedules, and forms.',
      val: accessibility.largeText,
    },
    {
      key: 'highContrast' as const,
      label: t('accessibility.highContrast'),
      hint: 'Sharpens text and card borders for easier reading.',
      val: accessibility.highContrast,
    },
    {
      key: 'largeButtons' as const,
      label: t('accessibility.largeButtons'),
      hint: 'Enlarges tap targets across medications and daily actions.',
      val: accessibility.largeButtons,
    },
    {
      key: 'simpleNavigation' as const,
      label: t('accessibility.simpleNavigation'),
      hint: 'Shows only essential daily menus in the sidebar.',
      val: accessibility.simpleNavigation,
    },
    {
      key: 'reducedMotion' as const,
      label: t('accessibility.reducedMotion'),
      hint: 'Minimizes animations and smooth-scroll transitions.',
      val: accessibility.reducedMotion,
    },
    {
      key: 'voiceEnabled' as const,
      label: t('accessibility.voiceEnabled'),
      hint: 'Displays Read Aloud buttons and Care Assistant voice controls.',
      val: accessibility.voiceEnabled,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('accessibility.title')}
        subtitle={t('accessibility.subtitle')}
        icon={<ShieldCheck className="w-6 h-6" />}
      />

      <div className="grid lg:grid-cols-2 gap-6">
        <section className="cb-card-3d rounded-2xl p-5 sm:p-6 space-y-4">
          <h2 className="text-lg font-bold text-[#3E0911] flex items-center gap-2">
            <Eye className="w-5 h-5 text-[#71774B]" />
            Display & Interaction Modes
          </h2>

          <div className="space-y-3">
            {toggles.map((item) => (
              <label
                key={item.key}
                className="min-h-[58px] flex items-center justify-between gap-4 p-3.5 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/10 cursor-pointer hover:bg-[#F3EDE3] transition-colors"
              >
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold text-[#3E0911]">{item.label}</div>
                  <div className="text-xs text-[#5D4A44] mt-0.5">{item.hint}</div>
                </div>
                <input
                  type="checkbox"
                  checked={item.val}
                  onChange={(e) => updateAccessibility({ [item.key]: e.target.checked })}
                  className="w-5 h-5 accent-[#71774B] shrink-0"
                />
              </label>
            ))}
          </div>
        </section>

        <section className="cb-card-3d rounded-2xl p-5 sm:p-6 space-y-4">
          <h2 className="text-lg font-bold text-[#3E0911] flex items-center gap-2">
            <Volume2 className="w-5 h-5 text-[#71774B]" />
            Voice Guidance & Capability Check
          </h2>

          <div className="p-4 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/10 text-sm space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[#5D4A44]">
                Active Language:{' '}
                <strong className="text-[#3E0911]">
                  {caps.languageCapability.nativeName} ({caps.languageCapability.englishName},{' '}
                  {caps.languageCapability.bcp47})
                </strong>
              </div>
              <button
                type="button"
                onClick={() => {
                  refreshBrowserVoices()
                    .then(() => setVoiceListEpoch((prev) => prev + 1))
                    .catch(() => {});
                  fetchServerVoiceCapabilities(true).then(setServerCaps).catch(() => {});
                }}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-[#3E0911]/15 text-sm font-semibold text-[#71774B] hover:text-[#383C23] cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                Refresh Voices
              </button>
            </div>
            <div className="text-[#5D4A44]">
              Browser Text-to-Speech Voice:{' '}
              <strong className={caps.hasVoiceForLanguage ? 'text-[#71774B]' : 'text-[#85383E]'}>
                {inventory.preferredVoice
                  ? `Available (${inventory.preferredVoice.name}, ${inventory.preferredVoice.lang})`
                  : inventory.totalVoices === 0
                    ? 'Loading or unavailable on this browser'
                    : `No ${caps.languageCapability.englishName} browser voice installed`}
              </strong>
            </div>
            <div className="text-[#5D4A44]">
              Server TTS Provider Fallback:{' '}
              <strong className={serverCaps.serverTtsAvailable ? 'text-[#71774B]' : 'text-[#85383E]'}>
                {!serverCaps.checked
                  ? 'Checking server...'
                  : serverCaps.serverTtsAvailable
                    ? `Active (${serverCaps.ttsProviders.filter((p) => p !== 'browser-speech-synthesis').join(', ')})`
                    : 'Not configured (enable server neural/Cloud TTS in deployment Secrets)'}
              </strong>
            </div>
            <div className="text-[#5D4A44]">
              Speech Recognition (Microphone):{' '}
              <strong
                className={
                  caps.speechRecognitionAvailable || caps.mediaRecorderAvailable
                    ? 'text-[#71774B]'
                    : 'text-[#85383E]'
                }
              >
                {caps.speechRecognitionAvailable
                  ? 'Browser Live Speech + Audio Clip capture active'
                  : caps.mediaRecorderAvailable
                    ? 'Audio Clip capture active (server neural transcription fallback)'
                    : 'Not available in this browser (text controls remain fully active)'}
              </strong>
            </div>
            <div className="text-xs text-[#5D4A44] pt-0.5">{caps.languageCapability.capabilityNote}</div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-[#3E0911] mr-1">Voice Speed:</span>
            {[
              { label: '0.8x Slow', val: 0.8 },
              { label: '0.95x Clear', val: 0.95 },
              { label: '1.15x Normal', val: 1.15 },
            ].map((opt) => (
              <button
                key={opt.val}
                type="button"
                onClick={() => handleRateChange(opt.val)}
                className={`min-h-[44px] px-3.5 py-2 rounded-xl border text-sm font-semibold cursor-pointer ${
                  Math.abs(speechRate - opt.val) < 0.05
                    ? 'bg-[#71774B] text-white border-[#71774B]'
                    : 'bg-[#FAF7F2] text-[#3E0911] border-[#3E0911]/15 hover:bg-[#E5DDD0]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleTestSpeech}
              className={`cb-btn-3d min-h-[48px] inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-[15px] font-semibold cursor-pointer ${
                speaking ? 'bg-[#85383E]' : 'bg-[#71774B] hover:bg-[#5E633D]'
              }`}
            >
              {speaking ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              {speaking ? 'Stop Speech' : t('accessibility.testSpeech')}
            </button>

            {(caps.speechRecognitionAvailable || caps.mediaRecorderAvailable) && (
              <button
                type="button"
                onClick={handleVoiceNavigate}
                className={`min-h-[48px] inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-[15px] font-semibold cursor-pointer ${
                  listening ? 'bg-[#85383E]' : 'bg-[#383C23] hover:bg-[#2A2D1A]'
                }`}
              >
                {listening ? <Square className="w-4 h-4 fill-current" /> : <Mic className="w-4 h-4" />}
                {listening ? 'Stop Listening' : t('accessibility.startVoiceCommand')}
              </button>
            )}
          </div>

          {transcript && (
            <div className="p-3.5 rounded-xl bg-[#FAF7F2] border border-[#71774B] text-sm space-y-1">
              <div>
                Heard: <strong>{transcript}</strong>
              </div>
              {voiceReply && <div className="text-[#383C23]">{voiceReply}</div>}
            </div>
          )}

          {ttsError && (
            <div
              role="alert"
              className="p-3.5 rounded-xl bg-[#F6EAEC] border border-[#85383E]/30 text-sm text-[#85383E] flex flex-wrap items-center justify-between gap-2"
            >
              <span>Spoken Audio: {ttsError}</span>
              <button
                type="button"
                onClick={handleTestSpeech}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-[#85383E]/30 text-sm text-[#3E0911] font-semibold shrink-0 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                Retry Speech
              </button>
            </div>
          )}

          {sttError && (
            <div
              role="alert"
              className="p-3.5 rounded-xl bg-[#F6EAEC] border border-[#85383E]/30 text-sm text-[#85383E] flex flex-wrap items-center justify-between gap-2"
            >
              <span>Microphone / Speech Recognition: {sttError}</span>
              <button
                type="button"
                onClick={handleVoiceNavigate}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-[#85383E]/30 text-sm text-[#3E0911] font-semibold shrink-0 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                Retry Mic
              </button>
            </div>
          )}
        </section>
      </div>

      {/* Transparent 23-Language Voice Capability Matrix */}
      <section className="cb-card-3d rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-[#3E0911] flex items-center gap-2">
              <Globe className="w-5 h-5 text-[#71774B]" />
              23-Language Voice & Script Capability Matrix
            </h2>
            <p className="text-sm text-[#5D4A44] mt-0.5">
              Transparent runtime availability across browser Web Speech, server neural audio
              capture/synthesis, and native-script text fallback.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowMatrix((prev) => !prev)}
            className="min-h-[44px] px-4 py-2 rounded-xl border border-[#3E0911]/15 bg-[#FAF7F2] hover:bg-[#E5DDD0] text-sm font-semibold text-[#3E0911] cursor-pointer"
          >
            {showMatrix ? 'Hide Matrix' : 'Show Matrix'}
          </button>
        </div>

        {showMatrix && (
          <>
            {/* Mobile Compact Cards */}
            <div className="md:hidden space-y-2.5">
              {VOICE_LANGUAGE_MATRIX.map((lang) => (
                <div
                  key={lang.code}
                  className="p-3.5 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/10 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-sm text-[#3E0911]">
                      {lang.englishName} · {lang.nativeName}
                    </span>
                    <span className="text-xs font-mono text-[#5D4A44]">
                      {lang.bcp47} ({lang.defaultDir.toUpperCase()})
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <span className="text-[#5D4A44]">
                      STT:{' '}
                      <strong className="text-[#3E0911]">
                        {lang.recognitionTier === 'browser_and_neural'
                          ? 'Browser + Neural'
                          : lang.recognitionTier === 'neural_primary'
                            ? 'Audio Clip + Neural'
                            : 'Experimental (Text Ready)'}
                      </strong>
                    </span>
                    <span className="text-[#5D4A44]">
                      TTS:{' '}
                      <strong className="text-[#3E0911]">
                        {lang.synthesisTier === 'browser_and_neural'
                          ? 'Browser + Neural WAV'
                          : lang.synthesisTier === 'neural_primary'
                            ? 'Neural WAV Primary'
                            : 'Experimental (Text Only)'}
                      </strong>
                    </span>
                  </div>
                  <p className="text-xs text-[#5D4A44]">{lang.capabilityNote}</p>
                </div>
              ))}
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[#3E0911]/15 text-[#5D4A44]">
                    <th className="py-2.5 pr-3 font-semibold">Language</th>
                    <th className="py-2.5 pr-3 font-semibold">BCP-47 / Script</th>
                    <th className="py-2.5 pr-3 font-semibold">Speech Recognition (STT)</th>
                    <th className="py-2.5 pr-3 font-semibold">Spoken Audio (TTS)</th>
                    <th className="py-2.5 font-semibold">Honest Runtime Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#3E0911]/10">
                  {VOICE_LANGUAGE_MATRIX.map((lang) => (
                    <tr key={lang.code} className="hover:bg-[#FAF7F2]/70">
                      <td className="py-3 pr-3 font-semibold text-[#3E0911] whitespace-nowrap">
                        {lang.englishName} · <span className="font-normal">{lang.nativeName}</span>
                      </td>
                      <td className="py-3 pr-3 font-mono text-xs text-[#5D4A44] whitespace-nowrap">
                        {lang.bcp47} ({lang.defaultScript}, {lang.defaultDir.toUpperCase()})
                      </td>
                      <td className="py-3 pr-3">
                        <span
                          className={`inline-block px-2.5 py-1 rounded-lg text-xs font-semibold ${
                            lang.recognitionTier === 'browser_and_neural'
                              ? 'bg-[#71774B]/15 text-[#383C23]'
                              : lang.recognitionTier === 'neural_primary'
                                ? 'bg-[#E5DDD0] text-[#3E0911]'
                                : 'bg-[#F6EAEC] text-[#85383E]'
                          }`}
                        >
                          {lang.recognitionTier === 'browser_and_neural'
                            ? 'Browser + Neural'
                            : lang.recognitionTier === 'neural_primary'
                              ? 'Audio Clip + Neural'
                              : 'Experimental (Text Ready)'}
                        </span>
                      </td>
                      <td className="py-3 pr-3">
                        <span
                          className={`inline-block px-2.5 py-1 rounded-lg text-xs font-semibold ${
                            lang.synthesisTier === 'browser_and_neural'
                              ? 'bg-[#71774B]/15 text-[#383C23]'
                              : lang.synthesisTier === 'neural_primary'
                                ? 'bg-[#E5DDD0] text-[#3E0911]'
                                : 'bg-[#F6EAEC] text-[#85383E]'
                          }`}
                        >
                          {lang.synthesisTier === 'browser_and_neural'
                            ? 'Browser + Neural WAV'
                            : lang.synthesisTier === 'neural_primary'
                              ? 'Neural WAV Primary'
                              : 'Experimental (Text Only)'}
                        </span>
                      </td>
                      <td className="py-3 text-xs text-[#5D4A44]">{lang.capabilityNote}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
};

