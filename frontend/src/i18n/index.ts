/**
 * i18n bootstrap.
 *
 * English is the source language and is the complete one: every other file is a
 * translation of it, and `fallbackLng: 'en'` means a missing Somali or Arabic
 * key shows English rather than a raw key string.
 *
 * Detection order is deliberate. The explicit choice in localStorage wins, so
 * a user who picked Somali keeps Somali even though the browser asks for
 * English. Only when nothing is stored does the browser decide.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from './en.json';
import ar from './ar.json';
import so from './so.json';

export const SUPPORTED_LANGUAGES = ['en', 'ar', 'so'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: SupportedLanguage = 'en';

export const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  en: 'English',
  ar: 'العربية',
  so: 'Soomaali',
};

/** Intl locale per language. Somali has no CLDR locale, so it falls back to en. */
const INTL_LOCALES: Record<SupportedLanguage, string> = {
  en: 'en-US',
  ar: 'ar',
  so: 'en-US',
};

/**
 * Only Arabic is right-to-left. Somali is written left-to-right, so `so` must
 * stay `ltr` or the whole dashboard mirrors for no reason.
 */
const DIRECTIONS: Record<SupportedLanguage, 'ltr' | 'rtl'> = {
  en: 'ltr',
  ar: 'rtl',
  so: 'ltr',
};

export function isSupported(code: string | undefined): code is SupportedLanguage {
  return !!code && (SUPPORTED_LANGUAGES as readonly string[]).includes(code);
}

export function directionFor(language: string): 'ltr' | 'rtl' {
  return isSupported(language) ? DIRECTIONS[language] : DIRECTIONS[DEFAULT_LANGUAGE];
}

export function intlLocaleFor(language: string): string {
  return isSupported(language) ? INTL_LOCALES[language] : INTL_LOCALES[DEFAULT_LANGUAGE];
}

/**
 * Writes the language and direction onto <html>, which is what actually makes
 * the browser lay the page out right-to-left. `lang` matters for screen
 * readers and for the font stack; `dir` matters for the visual mirror.
 */
export function applyDocumentLanguage(language: string): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = language;
  document.documentElement.dir = directionFor(language);
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ar: { translation: ar },
      so: { translation: so },
    },
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: [...SUPPORTED_LANGUAGES],
    nonExplicitSupportedLngs: true,
    interpolation: {
      // React already escapes, and i18next escaping on top would turn a
      // legitimate apostrophe into `&#39;` in the rendered output.
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      lookupLocalStorage: 'hq_language',
      caches: ['localStorage'],
    },
    react: {
      useSuspense: false,
    },
  });

i18n.on('languageChanged', applyDocumentLanguage);

// Covers the initial load too, not just a later change.
applyDocumentLanguage(i18n.resolvedLanguage ?? i18n.language);

export default i18n;
