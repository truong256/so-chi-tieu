/**
 * i18n Translation Service — Provides unified multilingual support (VI / EN).
 */

import viTranslations from "../locales/vi.json";
import enTranslations from "../locales/en.json";

export type Language = "vi" | "en";

export type TranslationDict = typeof viTranslations;

const DICTIONARIES: Record<Language, any> = {
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
      } catch {}
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
    } catch {}
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

  let val: any = dict;
  for (const part of parts) {
    if (val && typeof val === "object" && part in val) {
      val = val[part];
    } else {
      // Fallback to Vietnamese dictionary if key missing in target lang
      let fallbackVal: any = DICTIONARIES.vi;
      for (const fallbackPart of parts) {
        if (fallbackVal && typeof fallbackVal === "object" && fallbackPart in fallbackVal) {
          fallbackVal = fallbackVal[fallbackPart];
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
