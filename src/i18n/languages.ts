export interface LanguageScriptOption {
  id: string;
  label: string;
  dir: 'ltr' | 'rtl';
}

export interface SupportedLanguage {
  code: string;
  englishName: string;
  nativeName: string;
  bcp47: string;
  defaultScript: string;
  defaultDir: 'ltr' | 'rtl';
  scripts: LanguageScriptOption[];
}

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  {
    code: 'en',
    englishName: 'English',
    nativeName: 'English',
    bcp47: 'en-IN',
    defaultScript: 'Latin',
    defaultDir: 'ltr',
    scripts: [{ id: 'Latin', label: 'Latin', dir: 'ltr' }],
  },
  {
    code: 'hi',
    englishName: 'Hindi',
    nativeName: 'हिन्दी',
    bcp47: 'hi-IN',
    defaultScript: 'Devanagari',
    defaultDir: 'ltr',
    scripts: [{ id: 'Devanagari', label: 'देवनागरी (Devanagari)', dir: 'ltr' }],
  },
  {
    code: 'as',
    englishName: 'Assamese',
    nativeName: 'অসমীয়া',
    bcp47: 'as-IN',
    defaultScript: 'Bengali-Assamese',
    defaultDir: 'ltr',
    scripts: [{ id: 'Bengali-Assamese', label: 'অসমীয়া লিপি (Assamese)', dir: 'ltr' }],
  },
  {
    code: 'bn',
    englishName: 'Bengali',
    nativeName: 'বাংলা',
    bcp47: 'bn-IN',
    defaultScript: 'Bengali',
    defaultDir: 'ltr',
    scripts: [{ id: 'Bengali', label: 'বাংলা লিপি (Bengali)', dir: 'ltr' }],
  },
  {
    code: 'brx',
    englishName: 'Bodo',
    nativeName: 'बड़ो',
    bcp47: 'brx-IN',
    defaultScript: 'Devanagari',
    defaultDir: 'ltr',
    scripts: [{ id: 'Devanagari', label: 'देवनागरी (Devanagari)', dir: 'ltr' }],
  },
  {
    code: 'doi',
    englishName: 'Dogri',
    nativeName: 'डोगरी',
    bcp47: 'doi-IN',
    defaultScript: 'Devanagari',
    defaultDir: 'ltr',
    scripts: [{ id: 'Devanagari', label: 'देवनागरी (Devanagari)', dir: 'ltr' }],
  },
  {
    code: 'gu',
    englishName: 'Gujarati',
    nativeName: 'ગુજરાતી',
    bcp47: 'gu-IN',
    defaultScript: 'Gujarati',
    defaultDir: 'ltr',
    scripts: [{ id: 'Gujarati', label: 'ગુજરાતી (Gujarati)', dir: 'ltr' }],
  },
  {
    code: 'kn',
    englishName: 'Kannada',
    nativeName: 'ಕನ್ನಡ',
    bcp47: 'kn-IN',
    defaultScript: 'Kannada',
    defaultDir: 'ltr',
    scripts: [{ id: 'Kannada', label: 'ಕನ್ನಡ (Kannada)', dir: 'ltr' }],
  },
  {
    code: 'ks',
    englishName: 'Kashmiri',
    nativeName: 'کٲشُر / कॉशुर',
    bcp47: 'ks-IN',
    defaultScript: 'Perso-Arabic',
    defaultDir: 'rtl',
    scripts: [
      { id: 'Perso-Arabic', label: 'نستعلیق / Perso-Arabic (RTL)', dir: 'rtl' },
      { id: 'Devanagari', label: 'देवनागरी (Devanagari LTR)', dir: 'ltr' },
    ],
  },
  {
    code: 'kok',
    englishName: 'Konkani',
    nativeName: 'कोंकणी',
    bcp47: 'kok-IN',
    defaultScript: 'Devanagari',
    defaultDir: 'ltr',
    scripts: [
      { id: 'Devanagari', label: 'देवनागरी (Devanagari)', dir: 'ltr' },
      { id: 'Kannada', label: 'ಕನ್ನಡ (Kannada)', dir: 'ltr' },
    ],
  },
  {
    code: 'mai',
    englishName: 'Maithili',
    nativeName: 'मैथिली',
    bcp47: 'mai-IN',
    defaultScript: 'Devanagari',
    defaultDir: 'ltr',
    scripts: [{ id: 'Devanagari', label: 'देवनागरी (Devanagari)', dir: 'ltr' }],
  },
  {
    code: 'ml',
    englishName: 'Malayalam',
    nativeName: 'മലയാളം',
    bcp47: 'ml-IN',
    defaultScript: 'Malayalam',
    defaultDir: 'ltr',
    scripts: [{ id: 'Malayalam', label: 'മലയാളം (Malayalam)', dir: 'ltr' }],
  },
  {
    code: 'mni',
    englishName: 'Manipuri (Meitei)',
    nativeName: 'ꯃꯩꯇꯩꯂꯣꯟ',
    bcp47: 'mni-IN',
    defaultScript: 'Meitei-Mayek',
    defaultDir: 'ltr',
    scripts: [
      { id: 'Meitei-Mayek', label: 'ꯃꯩꯇꯩ ꯃꯌꯦꯛ (Meitei Mayek)', dir: 'ltr' },
      { id: 'Bengali', label: 'বাংলা লিপি (Bengali)', dir: 'ltr' },
    ],
  },
  {
    code: 'mr',
    englishName: 'Marathi',
    nativeName: 'मराठी',
    bcp47: 'mr-IN',
    defaultScript: 'Devanagari',
    defaultDir: 'ltr',
    scripts: [{ id: 'Devanagari', label: 'देवनागरी (Devanagari)', dir: 'ltr' }],
  },
  {
    code: 'ne',
    englishName: 'Nepali',
    nativeName: 'नेपाली',
    bcp47: 'ne-IN',
    defaultScript: 'Devanagari',
    defaultDir: 'ltr',
    scripts: [{ id: 'Devanagari', label: 'देवनागरी (Devanagari)', dir: 'ltr' }],
  },
  {
    code: 'or',
    englishName: 'Odia',
    nativeName: 'ଓଡ଼ିଆ',
    bcp47: 'or-IN',
    defaultScript: 'Odia',
    defaultDir: 'ltr',
    scripts: [{ id: 'Odia', label: 'ଓଡ଼ିଆ (Odia)', dir: 'ltr' }],
  },
  {
    code: 'pa',
    englishName: 'Punjabi',
    nativeName: 'ਪੰਜਾਬੀ',
    bcp47: 'pa-IN',
    defaultScript: 'Gurmukhi',
    defaultDir: 'ltr',
    scripts: [{ id: 'Gurmukhi', label: 'ਗੁਰਮੁਖੀ (Gurmukhi)', dir: 'ltr' }],
  },
  {
    code: 'sa',
    englishName: 'Sanskrit',
    nativeName: 'संस्कृतम्',
    bcp47: 'sa-IN',
    defaultScript: 'Devanagari',
    defaultDir: 'ltr',
    scripts: [{ id: 'Devanagari', label: 'देवनागरी (Devanagari)', dir: 'ltr' }],
  },
  {
    code: 'sat',
    englishName: 'Santali',
    nativeName: 'ᱥᱟᱱᱛᱟᱲᱤ',
    bcp47: 'sat-IN',
    defaultScript: 'Ol-Chiki',
    defaultDir: 'ltr',
    scripts: [
      { id: 'Ol-Chiki', label: 'ᱚᱞ ᱪᱤᱠᱤ (Ol Chiki)', dir: 'ltr' },
      { id: 'Devanagari', label: 'देवनागरी (Devanagari)', dir: 'ltr' },
    ],
  },
  {
    code: 'sd',
    englishName: 'Sindhi',
    nativeName: 'سنڌي / सिन्धी',
    bcp47: 'sd-IN',
    defaultScript: 'Perso-Arabic',
    defaultDir: 'rtl',
    scripts: [
      { id: 'Perso-Arabic', label: 'سنڌي عربي / Perso-Arabic (RTL)', dir: 'rtl' },
      { id: 'Devanagari', label: 'देवनागरी (Devanagari LTR)', dir: 'ltr' },
    ],
  },
  {
    code: 'ta',
    englishName: 'Tamil',
    nativeName: 'தமிழ்',
    bcp47: 'ta-IN',
    defaultScript: 'Tamil',
    defaultDir: 'ltr',
    scripts: [{ id: 'Tamil', label: 'தமிழ் (Tamil)', dir: 'ltr' }],
  },
  {
    code: 'te',
    englishName: 'Telugu',
    nativeName: 'తెలుగు',
    bcp47: 'te-IN',
    defaultScript: 'Telugu',
    defaultDir: 'ltr',
    scripts: [{ id: 'Telugu', label: 'తెలుగు (Telugu)', dir: 'ltr' }],
  },
  {
    code: 'ur',
    englishName: 'Urdu',
    nativeName: 'اردو',
    bcp47: 'ur-IN',
    defaultScript: 'Perso-Arabic',
    defaultDir: 'rtl',
    scripts: [{ id: 'Perso-Arabic', label: 'نستعلیق / Perso-Arabic (RTL)', dir: 'rtl' }],
  },
];

export function getLanguageMeta(code: string): SupportedLanguage {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code) ?? SUPPORTED_LANGUAGES[0];
}

export function resolveLanguageDirection(code: string, scriptId?: string): 'ltr' | 'rtl' {
  const lang = getLanguageMeta(code);
  if (scriptId) {
    const matched = lang.scripts.find((s) => s.id === scriptId);
    if (matched) return matched.dir;
  }
  return lang.defaultDir;
}
