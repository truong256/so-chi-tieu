/**
 * i18n Translation Service — Provides unified multilingual support (VI / EN).
 */

import viTranslations from "../locales/vi.json";
import enTranslations from "../locales/en.json";

export type Language = "vi" | "en";

export type TranslationDict = typeof viTranslations;

const DICTIONARIES: Record<Language, Record<string, unknown>> = {
  vi: viTranslations,
  en: enTranslations,
};

let currentLanguage: Language = "vi";

/**
 * Set the current application language.
 */
export function setAppLanguage(lang: Language) {
  if (lang === "vi" || lang === "en") {
    currentLanguage = lang;
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("app_language", lang);
      } catch {
        // Language preference remains available in memory when storage is blocked.
      }
    }
  }
}

/**
 * Get the current application language.
 */
export function getAppLanguage(): Language {
  if (typeof window !== "undefined") {
    try {
      const saved = localStorage.getItem("app_language") as Language | null;
      if (saved === "vi" || saved === "en") {
        currentLanguage = saved;
      }
    } catch {
      // Keep the in-memory language when storage is unavailable.
    }
  }
  return currentLanguage;
}

/**
 * Translate a dot-separated key (e.g. 'common.save', 'dashboard.greeting')
 * Supports variable interpolation (e.g. { name: 'John' }).
 */
export function t(
  key: string,
  params?: Record<string, string | number>,
  lang: Language = currentLanguage
): string {
  const dict = DICTIONARIES[lang] || DICTIONARIES.vi;
  const parts = key.split(".");

  let val: unknown = dict;
  for (const part of parts) {
    if (val && typeof val === "object" && !Array.isArray(val) && part in val) {
      val = (val as Record<string, unknown>)[part];
    } else {
      // Fallback to Vietnamese dictionary if key missing in target lang
      let fallbackVal: unknown = DICTIONARIES.vi;
      for (const fallbackPart of parts) {
        if (fallbackVal && typeof fallbackVal === "object" && !Array.isArray(fallbackVal) && fallbackPart in fallbackVal) {
          fallbackVal = (fallbackVal as Record<string, unknown>)[fallbackPart];
        } else {
          fallbackVal = key;
          break;
        }
      }
      val = fallbackVal;
      break;
    }
  }

  if (typeof val !== "string") {
    return key;
  }

  if (!params) {
    return val;
  }

  // Replace {paramName} placeholders
  return val.replace(/\{(\w+)\}/g, (_, k) => {
    return k in params ? String(params[k]) : `{${k}}`;
  });
}
