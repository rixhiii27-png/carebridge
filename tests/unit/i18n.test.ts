import { describe, expect, it } from 'vitest';
import {
  SUPPORTED_LANGUAGES,
  getLanguageMeta,
  resolveLanguageDirection,
} from '../../src/i18n/languages.ts';
import i18n from '../../src/i18n/index.ts';
import { en } from '../../src/i18n/locales/en.ts';

function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const next = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flattenKeys(v as Record<string, unknown>, next));
    } else {
      keys.push(next);
    }
  }
  return keys;
}

describe('Multilingual Support (22 Indian Eighth Schedule + English = 23)', () => {
  it('registers exactly 23 unique language definitions with valid BCP-47 tags', () => {
    expect(SUPPORTED_LANGUAGES).toHaveLength(23);
    const codes = new Set(SUPPORTED_LANGUAGES.map((l) => l.code));
    expect(codes.size).toBe(23);

    const expectedCodes = [
      'en', 'hi', 'as', 'bn', 'brx', 'doi', 'gu', 'kn', 'ks', 'kok',
      'mai', 'ml', 'mni', 'mr', 'ne', 'or', 'pa', 'sa', 'sat', 'sd',
      'ta', 'te', 'ur',
    ];
    for (const code of expectedCodes) {
      expect(codes.has(code)).toBe(true);
      const meta = getLanguageMeta(code);
      expect(meta.nativeName.trim().length).toBeGreaterThan(0);
      expect(meta.bcp47).toMatch(/^[a-z]{2,3}-[A-Z]{2}$/);
    }
  });

  it('resolves RTL direction for Perso-Arabic scripts and LTR for Devanagari/other scripts', () => {
    expect(resolveLanguageDirection('ur')).toBe('rtl');
    expect(resolveLanguageDirection('ks', 'Perso-Arabic')).toBe('rtl');
    expect(resolveLanguageDirection('ks', 'Devanagari')).toBe('ltr');
    expect(resolveLanguageDirection('sd', 'Perso-Arabic')).toBe('rtl');
    expect(resolveLanguageDirection('sd', 'Devanagari')).toBe('ltr');
    expect(resolveLanguageDirection('hi')).toBe('ltr');
    expect(resolveLanguageDirection('ta')).toBe('ltr');
  });

  it('loads non-empty translation resources for all 23 languages in i18next', () => {
    const coreSections = ['brand', 'nav', 'dashboard', 'medications', 'appointments', 'caregivers', 'notifications', 'accessibility', 'common'];
    const englishKeys = flattenKeys(en as unknown as Record<string, unknown>);
    expect(englishKeys.length).toBeGreaterThan(80);

    for (const lang of SUPPORTED_LANGUAGES) {
      const bundle = i18n.getResourceBundle(lang.code, 'translation') as Record<string, unknown> | undefined;
      expect(bundle, `Missing resource bundle for ${lang.code}`).toBeDefined();
      for (const section of coreSections) {
        expect(bundle?.[section], `Missing section "${section}" in ${lang.code}`).toBeDefined();
      }
      const keys = flattenKeys(bundle ?? {});
      expect(keys.length).toBeGreaterThan(50);
    }
  });

  it('formats dates cleanly using Intl.DateTimeFormat for each language BCP-47 tag', () => {
    const sampleDate = new Date('2026-04-15T09:30:00.000Z');
    for (const lang of SUPPORTED_LANGUAGES) {
      const formatted = new Intl.DateTimeFormat(lang.bcp47, {
        dateStyle: 'medium',
        timeZone: 'Asia/Kolkata',
      }).format(sampleDate);
      expect(typeof formatted).toBe('string');
      expect(formatted.trim().length).toBeGreaterThan(3);
    }
  });
});
