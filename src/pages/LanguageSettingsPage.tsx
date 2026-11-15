import React, { useState } from 'react';
import { AlertCircle, Check, Globe, Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/common/AccessibleWidgets.tsx';
import { useCareBridge } from '../context/CareBridgeContext.tsx';
import { getLanguageMeta, SUPPORTED_LANGUAGES } from '../i18n/languages.ts';
import { getAuthenticatedIdToken } from '../services/firestoreService.ts';

export const LanguageSettingsPage: React.FC = () => {
  const { t } = useTranslation();
  const { languageCode, scriptId, dir, setLanguageAndScript } = useCareBridge();

  const [sampleNote, setSampleNote] = useState('Take after breakfast with water.');
  const [translatedNote, setTranslatedNote] = useState<string | null>(null);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);

  const activeLang = getLanguageMeta(languageCode);

  const formattedNow = (() => {
    try {
      return new Intl.DateTimeFormat(activeLang.bcp47, {
        dateStyle: 'full',
        timeStyle: 'short',
      }).format(new Date());
    } catch {
      return new Date().toLocaleString();
    }
  })();

  const handleServerTranslate = async () => {
    setTranslating(true);
    setTranslateError(null);
    try {
      const token = await getAuthenticatedIdToken();
      if (!token) {
        setTranslateError('Sign in to test server-side translation.');
        return;
      }
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          text: sampleNote,
          targetLanguage: activeLang.englishName,
          isMedicationName: false,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Unable to translate care note.');
      }
      if (data.translatedText) {
        setTranslatedNote(data.translatedText);
      }
    } catch (err) {
      setTranslateError(err instanceof Error ? err.message : 'Unable to translate care note.');
    } finally {
      setTranslating(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('nav.languageSettings')}
        subtitle="22 Indian Constitutional Eighth Schedule languages plus English, with script and RTL layout support."
        icon={<Globe className="w-6 h-6" />}
      />

      {/* Active Language, Script & Localized Time Preview */}
      <section className="cb-card-3d rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-medium text-[#5D4A44]">Active Language & Direction</div>
            <div className="text-xl font-bold text-[#3E0911] mt-0.5">
              {activeLang.nativeName} ({activeLang.englishName}) · {dir.toUpperCase()}
            </div>
            <div className="text-sm text-[#5D4A44] mt-1 tabular-nums">
              Localized Date & Time: {formattedNow}
            </div>
          </div>

          {activeLang.scripts.length > 1 && (
            <div className="min-w-[200px]">
              <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
                Script Preference
              </label>
              <select
                value={scriptId}
                onChange={(e) => setLanguageAndScript(languageCode, e.target.value)}
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/20 text-base text-[#3E0911]"
              >
                {activeLang.scripts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </section>

      {/* 23-Language Selector Grid */}
      <section className="cb-card-3d rounded-2xl p-5 sm:p-6">
        <h2 className="text-lg font-bold text-[#3E0911] mb-4">
          Select Interface Language ({SUPPORTED_LANGUAGES.length} Supported)
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {SUPPORTED_LANGUAGES.map((lang) => {
            const isSelected = lang.code === languageCode;
            return (
              <button
                key={lang.code}
                type="button"
                aria-pressed={isSelected}
                onClick={() => setLanguageAndScript(lang.code, lang.defaultScript)}
                className={`text-left min-h-[58px] p-3.5 rounded-xl border transition-all flex items-center justify-between gap-2 cursor-pointer ${
                  isSelected
                    ? 'bg-[#71774B] text-white border-[#71774B] shadow-sm'
                    : 'bg-[#FAF7F2] text-[#3E0911] border-[#3E0911]/15 hover:bg-[#E5DDD0]'
                }`}
              >
                <div className="min-w-0">
                  <div className="font-bold text-base truncate">{lang.nativeName}</div>
                  <div
                    className={`text-sm truncate ${
                      isSelected ? 'text-white/90' : 'text-[#5D4A44]'
                    }`}
                  >
                    {lang.englishName} · {lang.defaultDir.toUpperCase()}
                  </div>
                </div>
                {isSelected && <Check className="w-5 h-5 shrink-0" />}
              </button>
            );
          })}
        </div>
      </section>

      {/* Optional Server-Side Care Note Translation Preview */}
      <section className="cb-card-3d rounded-2xl p-5 sm:p-6 space-y-3.5">
        <h2 className="text-lg font-bold text-[#3E0911] flex items-center gap-2">
          <Languages className="w-5 h-5 text-[#71774B]" />
          Optional Server-Side Note Translation Helper
        </h2>
        <p className="text-sm text-[#5D4A44]">
          Preserves original text, never translates medication brand names or alters dosages, and labels machine translations clearly.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={sampleNote}
            onChange={(e) => setSampleNote(e.target.value)}
            aria-label="Sample care note to translate"
            className="flex-1 min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/20 text-base text-[#3E0911]"
          />
          <button
            type="button"
            disabled={translating || !sampleNote.trim()}
            onClick={handleServerTranslate}
            className="cb-btn-3d min-h-[48px] px-5 py-2.5 rounded-xl bg-[#383C23] hover:bg-[#2A2D1A] text-white text-sm font-semibold cursor-pointer whitespace-nowrap disabled:opacity-60"
          >
            {translating ? 'Translating...' : `Translate to ${activeLang.englishName}`}
          </button>
        </div>
        {translateError && (
          <div
            role="alert"
            className="p-3.5 rounded-xl bg-[#F6EAEC] border border-[#85383E]/30 text-sm text-[#3E0911] flex items-center gap-2"
          >
            <AlertCircle className="w-4 h-4 text-[#85383E] shrink-0" />
            <span>{translateError}</span>
          </div>
        )}
        {translatedNote && (
          <div className="p-4 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/15 text-[15px]">
            <div className="text-xs font-bold text-[#85383E] mb-1">
              Machine-generated translation (original preserved above)
            </div>
            <div className="text-[#3E0911]">{translatedNote}</div>
          </div>
        )}
      </section>
    </div>
  );
};

