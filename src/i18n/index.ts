import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './locales/en.ts';
import { indicNorth } from './dictionaries/indicNorth.ts';
import { indicSouthEast } from './dictionaries/indicSouthEast.ts';
import { indicWestTribalRtl } from './dictionaries/indicWestTribalRtl.ts';

function wrapTranslation(dict: Record<string, unknown>) {
  return { translation: dict };
}

const resources: Record<string, { translation: Record<string, unknown> }> = {
  en: wrapTranslation(en as unknown as Record<string, unknown>),
  hi: wrapTranslation(indicNorth.hi),
  mr: wrapTranslation(indicNorth.mr),
  ne: wrapTranslation(indicNorth.ne),
  pa: wrapTranslation(indicNorth.pa),
  doi: wrapTranslation(indicNorth.doi),
  mai: wrapTranslation(indicNorth.mai),
  sa: wrapTranslation(indicNorth.sa),
  brx: wrapTranslation(indicNorth.brx),
  bn: wrapTranslation(indicSouthEast.bn),
  as: wrapTranslation(indicSouthEast.as),
  or: wrapTranslation(indicSouthEast.or),
  ta: wrapTranslation(indicSouthEast.ta),
  te: wrapTranslation(indicSouthEast.te),
  kn: wrapTranslation(indicSouthEast.kn),
  ml: wrapTranslation(indicSouthEast.ml),
  mni: wrapTranslation(indicSouthEast.mni),
  gu: wrapTranslation(indicWestTribalRtl.gu),
  kok: wrapTranslation(indicWestTribalRtl.kok),
  ur: wrapTranslation(indicWestTribalRtl.ur),
  ks: wrapTranslation(indicWestTribalRtl.ks),
  sd: wrapTranslation(indicWestTribalRtl.sd),
  sat: wrapTranslation(indicWestTribalRtl.sat),
};

const savedLang =
  typeof window !== 'undefined' ? window.localStorage.getItem('carebridge_lang') || 'en' : 'en';

i18n.use(initReactI18next).init({
  resources,
  lng: resources[savedLang] ? savedLang : 'en',
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
