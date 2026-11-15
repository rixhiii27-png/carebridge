export type VoiceSupportTier =
  | 'browser_and_neural'
  | 'neural_primary'
  | 'experimental_text_fallback';

export type NeuralSupportLevel = 'full' | 'partial' | 'experimental';

export interface VoiceLanguageCapability {
  code: string;
  englishName: string;
  nativeName: string;
  bcp47: string;
  defaultScript: string;
  defaultDir: 'ltr' | 'rtl';
  recognitionTier: VoiceSupportTier;
  synthesisTier: VoiceSupportTier;
  browserSttExpected: boolean;
  neuralServerSupport: NeuralSupportLevel;
  aliases: string[];
  capabilityNote: string;
}

export const VOICE_LANGUAGE_MATRIX: VoiceLanguageCapability[] = [
  {
    code: 'en',
    englishName: 'English',
    nativeName: 'English',
    bcp47: 'en-IN',
    defaultScript: 'Latin',
    defaultDir: 'ltr',
    recognitionTier: 'browser_and_neural',
    synthesisTier: 'browser_and_neural',
    browserSttExpected: true,
    neuralServerSupport: 'full',
    aliases: ['english', 'ingrezi', 'अंग्रेजी', 'अंग्रेज़ी', 'ಇಂಗ್ಲಿಷ್'],
    capabilityNote: 'Full browser & neural server STT/TTS support (Indian English accent supported).',
  },
  {
    code: 'hi',
    englishName: 'Hindi',
    nativeName: 'हिन्दी',
    bcp47: 'hi-IN',
    defaultScript: 'Devanagari',
    defaultDir: 'ltr',
    recognitionTier: 'browser_and_neural',
    synthesisTier: 'browser_and_neural',
    browserSttExpected: true,
    neuralServerSupport: 'full',
    aliases: ['hindi', 'हिन्दी', 'हिंदी', 'ಹಿಂದಿ'],
    capabilityNote: 'Full browser Web Speech & neural server STT/TTS in Devanagari.',
  },
  {
    code: 'kn',
    englishName: 'Kannada',
    nativeName: 'ಕನ್ನಡ',
    bcp47: 'kn-IN',
    defaultScript: 'Kannada',
    defaultDir: 'ltr',
    recognitionTier: 'browser_and_neural',
    synthesisTier: 'browser_and_neural',
    browserSttExpected: true,
    neuralServerSupport: 'full',
    aliases: ['kannada', 'ಕನ್ನಡ', 'कन्नड़'],
    capabilityNote: 'Full browser Web Speech (on Chrome/Android) & neural server audio STT/TTS fallback.',
  },
  {
    code: 'te',
    englishName: 'Telugu',
    nativeName: 'తెలుగు',
    bcp47: 'te-IN',
    defaultScript: 'Telugu',
    defaultDir: 'ltr',
    recognitionTier: 'browser_and_neural',
    synthesisTier: 'browser_and_neural',
    browserSttExpected: true,
    neuralServerSupport: 'full',
    aliases: ['telugu', 'తెలుగు', 'तेलुगु', 'ತೆಲುಗು'],
    capabilityNote: 'Full browser Web Speech & neural server audio STT/TTS.',
  },
  {
    code: 'ta',
    englishName: 'Tamil',
    nativeName: 'தமிழ்',
    bcp47: 'ta-IN',
    defaultScript: 'Tamil',
    defaultDir: 'ltr',
    recognitionTier: 'browser_and_neural',
    synthesisTier: 'browser_and_neural',
    browserSttExpected: true,
    neuralServerSupport: 'full',
    aliases: ['tamil', 'தமிழ்', 'तमिल', 'ತಮಿಳು'],
    capabilityNote: 'Full browser Web Speech & neural server audio STT/TTS.',
  },
  {
    code: 'ml',
    englishName: 'Malayalam',
    nativeName: 'മലയാളം',
    bcp47: 'ml-IN',
    defaultScript: 'Malayalam',
    defaultDir: 'ltr',
    recognitionTier: 'browser_and_neural',
    synthesisTier: 'browser_and_neural',
    browserSttExpected: true,
    neuralServerSupport: 'full',
    aliases: ['malayalam', 'മലയാളം', 'मलयालम', 'ಮಲಯಾಳಂ'],
    capabilityNote: 'Full browser Web Speech & neural server audio STT/TTS.',
  },
  {
    code: 'mr',
    englishName: 'Marathi',
    nativeName: 'मराठी',
    bcp47: 'mr-IN',
    defaultScript: 'Devanagari',
    defaultDir: 'ltr',
    recognitionTier: 'browser_and_neural',
    synthesisTier: 'browser_and_neural',
    browserSttExpected: true,
    neuralServerSupport: 'full',
    aliases: ['marathi', 'मराठी', 'ಮರಾಠಿ'],
    capabilityNote: 'Full browser Web Speech & neural server audio STT/TTS.',
  },
  {
    code: 'bn',
    englishName: 'Bengali',
    nativeName: 'বাংলা',
    bcp47: 'bn-IN',
    defaultScript: 'Bengali',
    defaultDir: 'ltr',
    recognitionTier: 'browser_and_neural',
    synthesisTier: 'browser_and_neural',
    browserSttExpected: true,
    neuralServerSupport: 'full',
    aliases: ['bengali', 'bangla', 'বাংলা', 'बंगाली', 'ಬಂಗಾಳಿ'],
    capabilityNote: 'Full browser Web Speech & neural server audio STT/TTS.',
  },
  {
    code: 'gu',
    englishName: 'Gujarati',
    nativeName: 'ગુજરાતી',
    bcp47: 'gu-IN',
    defaultScript: 'Gujarati',
    defaultDir: 'ltr',
    recognitionTier: 'browser_and_neural',
    synthesisTier: 'browser_and_neural',
    browserSttExpected: true,
    neuralServerSupport: 'full',
    aliases: ['gujarati', 'ગુજરાતી', 'गुजराती', 'ಗುಜರಾತಿ'],
    capabilityNote: 'Full browser Web Speech & neural server audio STT/TTS.',
  },
  {
    code: 'pa',
    englishName: 'Punjabi',
    nativeName: 'ਪੰਜਾਬੀ',
    bcp47: 'pa-IN',
    defaultScript: 'Gurmukhi',
    defaultDir: 'ltr',
    recognitionTier: 'browser_and_neural',
    synthesisTier: 'browser_and_neural',
    browserSttExpected: true,
    neuralServerSupport: 'full',
    aliases: ['punjabi', 'ਪੰਜਾਬੀ', 'पंजाबी', 'ಪಂಜಾಬಿ'],
    capabilityNote: 'Browser STT on supported OS engines + neural server audio STT/TTS.',
  },
  {
    code: 'ur',
    englishName: 'Urdu',
    nativeName: 'اردو',
    bcp47: 'ur-IN',
    defaultScript: 'Perso-Arabic',
    defaultDir: 'rtl',
    recognitionTier: 'browser_and_neural',
    synthesisTier: 'browser_and_neural',
    browserSttExpected: true,
    neuralServerSupport: 'full',
    aliases: ['urdu', 'اردو', 'उर्दू', 'ಉರ್ದು'],
    capabilityNote: 'Browser Web Speech & neural server STT/TTS with RTL script support.',
  },
  {
    code: 'ne',
    englishName: 'Nepali',
    nativeName: 'नेपाली',
    bcp47: 'ne-IN',
    defaultScript: 'Devanagari',
    defaultDir: 'ltr',
    recognitionTier: 'browser_and_neural',
    synthesisTier: 'browser_and_neural',
    browserSttExpected: true,
    neuralServerSupport: 'full',
    aliases: ['nepali', 'नेपाली', 'ನೇಪಾಳಿ'],
    capabilityNote: 'Browser Web Speech (OS dependent) & neural server audio STT/TTS.',
  },
  {
    code: 'or',
    englishName: 'Odia',
    nativeName: 'ଓଡ଼ିଆ',
    bcp47: 'or-IN',
    defaultScript: 'Odia',
    defaultDir: 'ltr',
    recognitionTier: 'neural_primary',
    synthesisTier: 'neural_primary',
    browserSttExpected: false,
    neuralServerSupport: 'partial',
    aliases: ['odia', 'oriya', 'ଓଡ଼ିଆ', 'ओड़िया'],
    capabilityNote: 'Limited native browser voice support; uses neural server audio clip STT/TTS & text fallback.',
  },
  {
    code: 'as',
    englishName: 'Assamese',
    nativeName: 'অসমীয়া',
    bcp47: 'as-IN',
    defaultScript: 'Bengali-Assamese',
    defaultDir: 'ltr',
    recognitionTier: 'neural_primary',
    synthesisTier: 'neural_primary',
    browserSttExpected: false,
    neuralServerSupport: 'partial',
    aliases: ['assamese', 'অসমীয়া', 'असमिया'],
    capabilityNote: 'Limited native browser voice support; uses neural server audio clip STT/TTS & text fallback.',
  },
  {
    code: 'kok',
    englishName: 'Konkani',
    nativeName: 'कोंकणी',
    bcp47: 'kok-IN',
    defaultScript: 'Devanagari',
    defaultDir: 'ltr',
    recognitionTier: 'neural_primary',
    synthesisTier: 'neural_primary',
    browserSttExpected: false,
    neuralServerSupport: 'partial',
    aliases: ['konkani', 'कोंकणी', 'ಕೊಂಕಣಿ'],
    capabilityNote: 'Browser Web Speech generally absent; uses neural server audio STT/TTS & text fallback.',
  },
  {
    code: 'mai',
    englishName: 'Maithili',
    nativeName: 'मैथिली',
    bcp47: 'mai-IN',
    defaultScript: 'Devanagari',
    defaultDir: 'ltr',
    recognitionTier: 'neural_primary',
    synthesisTier: 'neural_primary',
    browserSttExpected: false,
    neuralServerSupport: 'partial',
    aliases: ['maithili', 'मैथिली'],
    capabilityNote: 'Browser Web Speech generally absent; uses neural server audio STT/TTS & text fallback.',
  },
  {
    code: 'doi',
    englishName: 'Dogri',
    nativeName: 'डोगरी',
    bcp47: 'doi-IN',
    defaultScript: 'Devanagari',
    defaultDir: 'ltr',
    recognitionTier: 'neural_primary',
    synthesisTier: 'neural_primary',
    browserSttExpected: false,
    neuralServerSupport: 'partial',
    aliases: ['dogri', 'डोगरी'],
    capabilityNote: 'Browser Web Speech absent; uses neural server audio STT/TTS & Devanagari text fallback.',
  },
  {
    code: 'sa',
    englishName: 'Sanskrit',
    nativeName: 'संस्कृतम्',
    bcp47: 'sa-IN',
    defaultScript: 'Devanagari',
    defaultDir: 'ltr',
    recognitionTier: 'neural_primary',
    synthesisTier: 'neural_primary',
    browserSttExpected: false,
    neuralServerSupport: 'partial',
    aliases: ['sanskrit', 'संस्कृत', 'संस्कृतम्', 'ಸಂಸ್ಕೃತ'],
    capabilityNote: 'Browser Web Speech absent; uses neural server audio STT/TTS & Devanagari text fallback.',
  },
  {
    code: 'ks',
    englishName: 'Kashmiri',
    nativeName: 'کٲشُر / कॉशुर',
    bcp47: 'ks-IN',
    defaultScript: 'Perso-Arabic',
    defaultDir: 'rtl',
    recognitionTier: 'neural_primary',
    synthesisTier: 'neural_primary',
    browserSttExpected: false,
    neuralServerSupport: 'partial',
    aliases: ['kashmiri', 'کٲشُر', 'कॉशुर', 'कश्मीरी'],
    capabilityNote: 'Browser Web Speech absent; uses neural server audio STT/TTS with RTL/LTR script & text fallback.',
  },
  {
    code: 'sd',
    englishName: 'Sindhi',
    nativeName: 'سنڌي / सिन्धी',
    bcp47: 'sd-IN',
    defaultScript: 'Perso-Arabic',
    defaultDir: 'rtl',
    recognitionTier: 'neural_primary',
    synthesisTier: 'neural_primary',
    browserSttExpected: false,
    neuralServerSupport: 'partial',
    aliases: ['sindhi', 'سنڌي', 'सिन्धी', 'सिंधी'],
    capabilityNote: 'Browser Web Speech absent; uses neural server audio STT/TTS with RTL/LTR script & text fallback.',
  },
  {
    code: 'mni',
    englishName: 'Manipuri (Meitei)',
    nativeName: 'ꯃꯩꯇꯩꯂꯣꯟ',
    bcp47: 'mni-IN',
    defaultScript: 'Meitei-Mayek',
    defaultDir: 'ltr',
    recognitionTier: 'experimental_text_fallback',
    synthesisTier: 'experimental_text_fallback',
    browserSttExpected: false,
    neuralServerSupport: 'experimental',
    aliases: ['manipuri', 'meitei', 'ꯃꯩꯇꯩꯂꯣꯟ', 'मणिपुरी'],
    capabilityNote: 'Experimental voice support only (no standard browser STT/TTS engine); accessible text UI fully active.',
  },
  {
    code: 'brx',
    englishName: 'Bodo',
    nativeName: 'बड़ो',
    bcp47: 'brx-IN',
    defaultScript: 'Devanagari',
    defaultDir: 'ltr',
    recognitionTier: 'experimental_text_fallback',
    synthesisTier: 'experimental_text_fallback',
    browserSttExpected: false,
    neuralServerSupport: 'experimental',
    aliases: ['bodo', 'बड़ो', 'बोडो'],
    capabilityNote: 'Experimental voice support only (no standard browser STT/TTS engine); Devanagari text UI fully active.',
  },
  {
    code: 'sat',
    englishName: 'Santali',
    nativeName: 'ᱥᱟᱱᱛᱟᱲᱤ',
    bcp47: 'sat-IN',
    defaultScript: 'Ol-Chiki',
    defaultDir: 'ltr',
    recognitionTier: 'experimental_text_fallback',
    synthesisTier: 'experimental_text_fallback',
    browserSttExpected: false,
    neuralServerSupport: 'experimental',
    aliases: ['santali', 'santhali', 'ᱥᱟᱱᱛᱟᱲᱤ', 'संताली'],
    capabilityNote: 'Experimental voice support only (no standard browser STT/TTS engine); accessible text UI fully active.',
  },
];

export const VOICE_MATRIX_BY_CODE: Record<string, VoiceLanguageCapability> = Object.fromEntries(
  VOICE_LANGUAGE_MATRIX.map((entry) => [entry.code, entry]),
);

export function getVoiceLanguageCapability(languageCode: string): VoiceLanguageCapability {
  const normalized = (languageCode || 'en').trim().toLowerCase();
  return VOICE_MATRIX_BY_CODE[normalized] ?? VOICE_LANGUAGE_MATRIX[0];
}

export function detectScriptLanguageHint(text: string): string | null {
  const sample = text.trim();
  if (!sample) return null;
  if (/[\u0C80-\u0CFF]/.test(sample)) return 'kn';
  if (/[\u0C00-\u0C7F]/.test(sample)) return 'te';
  if (/[\u0B80-\u0BFF]/.test(sample)) return 'ta';
  if (/[\u0D00-\u0D7F]/.test(sample)) return 'ml';
  if (/[\u0A80-\u0AFF]/.test(sample)) return 'gu';
  if (/[\u0A00-\u0A7F]/.test(sample)) return 'pa';
  if (/[\u0B00-\u0B7F]/.test(sample)) return 'or';
  if (/[\u0980-\u09FF]/.test(sample)) return 'bn';
  if (/[\u1C50-\u1C7F]/.test(sample)) return 'sat';
  if (/[\uABC0-\uABFF]/.test(sample)) return 'mni';
  if (/[\u0600-\u06FF]/.test(sample)) return 'ur';
  if (/[\u0900-\u097F]/.test(sample)) return 'hi';
  return null;
}

export function findLanguageSwitchTarget(text: string): VoiceLanguageCapability | null {
  const lower = text.toLowerCase();
  const hasSwitchVerb =
    /\b(change|switch|set|use|speak|talk|prefer|language)\b/.test(lower) ||
    /(बदल|भाषा|बोल|ಬದಲಾಯಿಸ|ಭಾಷೆ|ಮಾತನಾಡ|மாற்று|மொழி|మార్చు|భాష)/.test(text);

  if (!hasSwitchVerb) return null;

  for (const lang of VOICE_LANGUAGE_MATRIX) {
    for (const alias of lang.aliases) {
      if (lower.includes(alias.toLowerCase())) {
        return lang;
      }
    }
  }
  return null;
}
