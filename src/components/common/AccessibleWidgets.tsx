import React, { useEffect, useState } from 'react';
import { AlertTriangle, Play, Square, Volume2, VolumeX, X } from 'lucide-react';
import { useCareBridge } from '../../context/CareBridgeContext.tsx';
import {
  playCachedAudioBuffer,
  speakTextWithFallback,
  stopAllVoicePlayback,
  unlockMobileAudioPlayback,
  type CachedAudioPayload,
} from '../../services/voiceService.ts';

export const ReadAloudButton: React.FC<{
  text: string;
  label: string;
  compact?: boolean;
}> = ({ text, label, compact = false }) => {
  const { languageCode } = useCareBridge();
  const [speaking, setSpeaking] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pendingTapPlay, setPendingTapPlay] = useState<CachedAudioPayload | null>(null);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden && speaking) {
        stopAllVoicePlayback();
        setSpeaking(false);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [speaking]);

  const handleToggleSpeak = async () => {
    unlockMobileAudioPlayback();

    if (speaking) {
      stopAllVoicePlayback();
      setSpeaking(false);
      return;
    }

    if (pendingTapPlay) {
      const cached = pendingTapPlay;
      setPendingTapPlay(null);
      setFeedback(null);
      const res = await playCachedAudioBuffer({
        cachedAudio: cached,
        onStart: () => setSpeaking(true),
        onEnd: () => setSpeaking(false),
        onError: () => setSpeaking(false),
      });
      if (!res.spoken && res.reason) {
        setFeedback(res.reason);
      }
      return;
    }

    setFeedback(null);
    const result = await speakTextWithFallback({
      text,
      languageCode,
      onStart: () => setSpeaking(true),
      onEnd: () => setSpeaking(false),
      onError: () => setSpeaking(false),
    });

    if (!result.spoken) {
      setSpeaking(false);
      if (result.autoplayBlocked && result.cachedAudio) {
        setPendingTapPlay(result.cachedAudio);
        setFeedback('Tap again to play audio');
      } else {
        setFeedback(result.reason || 'Voice playback unavailable for this language');
        setTimeout(() => setFeedback(null), 4500);
      }
    }
  };

  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={handleToggleSpeak}
        aria-label={speaking ? 'Stop reading aloud' : pendingTapPlay ? 'Tap to play audio' : label}
        title={speaking ? 'Stop reading aloud' : pendingTapPlay ? 'Tap to play audio' : label}
        className={`inline-flex items-center justify-center gap-2 min-h-[44px] ${
          compact ? 'min-w-[44px] px-3' : 'px-4'
        } py-2 rounded-xl border text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
          speaking
            ? 'border-[#85383E] bg-[#F6EAEC] text-[#85383E]'
            : pendingTapPlay
              ? 'border-[#383C23] bg-[#383C23] text-white'
              : 'border-[#3E0911]/20 bg-[#FAF7F2] hover:bg-[#E5DDD0] text-[#3E0911]'
        }`}
      >
        {speaking ? (
          <Square className="w-4 h-4 fill-current shrink-0" />
        ) : pendingTapPlay ? (
          <Play className="w-4 h-4 fill-current shrink-0" />
        ) : (
          <Volume2 className="w-4 h-4 text-[#71774B] shrink-0" />
        )}
        {!compact && <span>{speaking ? 'Stop' : pendingTapPlay ? 'Tap to Play' : label}</span>}
      </button>
      {feedback && !pendingTapPlay && (
        <span className="inline-flex items-center gap-1 text-xs text-[#85383E]" role="status">
          <VolumeX className="w-3.5 h-3.5 shrink-0" />
          <span className="max-w-[240px] truncate">{feedback}</span>
        </span>
      )}
    </div>
  );
};

export const PageHeader: React.FC<{
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
}> = ({ title, subtitle, icon, actions }) => (
  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
    <div className="min-w-0">
      <h1 className="font-display text-2xl sm:text-[28px] font-bold text-[#3E0911] flex items-center gap-2.5">
        {icon && <span className="shrink-0 text-[#71774B]">{icon}</span>}
        <span className="truncate">{title}</span>
      </h1>
      {subtitle && <p className="text-[15px] text-[#5D4A44] mt-1 leading-relaxed">{subtitle}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2.5 shrink-0">{actions}</div>}
  </div>
);

export const ConfirmDialog: React.FC<{
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'danger',
  busy = false,
  onConfirm,
  onCancel,
}) => {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-[#3E0911]/45 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="cb-confirm-title"
      aria-describedby="cb-confirm-desc"
    >
      <div className="cb-card-3d w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl p-6 space-y-5 bg-white">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                tone === 'danger'
                  ? 'bg-[#F6EAEC] text-[#85383E]'
                  : 'bg-[#71774B]/15 text-[#383C23]'
              }`}
            >
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h2 id="cb-confirm-title" className="font-display text-lg font-bold text-[#3E0911]">
                {title}
              </h2>
              <p id="cb-confirm-desc" className="text-[15px] text-[#5D4A44] mt-1 leading-relaxed">
                {description}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            aria-label={cancelLabel}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl hover:bg-[#FAF7F2] text-[#5D4A44] cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="min-h-[48px] px-5 py-2.5 rounded-xl border border-[#3E0911]/20 bg-[#FAF7F2] hover:bg-[#E5DDD0] text-[15px] font-semibold text-[#3E0911] cursor-pointer"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`cb-btn-3d min-h-[48px] px-5 py-2.5 rounded-xl text-white text-[15px] font-bold cursor-pointer disabled:opacity-60 ${
              tone === 'danger'
                ? 'bg-[#85383E] hover:bg-[#6D2B30]'
                : 'bg-[#71774B] hover:bg-[#5E633D]'
            }`}
          >
            {busy ? 'Please wait...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export const EmptyStateCard: React.FC<{
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}> = ({ title, description, actionLabel, onAction }) => (
  <div className="cb-card-3d rounded-2xl p-7 sm:p-9 text-center">
    <h3 className="text-lg font-bold text-[#3E0911] mb-2">{title}</h3>
    <p className="text-[15px] text-[#5D4A44] max-w-md mx-auto mb-5 leading-relaxed">{description}</p>
    {actionLabel && onAction && (
      <button
        type="button"
        onClick={onAction}
        className="cb-btn-3d min-h-[48px] inline-flex items-center justify-center px-6 py-3 rounded-xl bg-[#71774B] hover:bg-[#5E633D] text-white text-[15px] font-semibold cursor-pointer whitespace-nowrap"
      >
        {actionLabel}
      </button>
    )}
  </div>
);

export const LoadingSkeletonRows: React.FC<{ rows?: number }> = ({ rows = 4 }) => (
  <div className="space-y-3" aria-busy="true" aria-label="Loading">
    {Array.from({ length: rows }).map((_, i) => (
      <div
        key={i}
        className="h-16 rounded-2xl bg-[#FAF7F2] border border-[#3E0911]/10 animate-pulse"
      />
    ))}
  </div>
);
