import es, { type Messages } from "./es";
import en from "./en";
import zh from "./zh";
import hi from "./hi";
import ar from "./ar";
import pt from "./pt";
import fr from "./fr";
import ru from "./ru";
import ja from "./ja";
import de from "./de";

export type { Messages };

export type Lang = "es" | "en" | "zh" | "hi" | "ar" | "pt" | "fr" | "ru" | "ja" | "de";

export const dictionaries: Record<Lang, Messages> = {
  es,
  en,
  zh,
  hi,
  ar,
  pt,
  fr,
  ru,
  ja,
  de,
};

export const languageNames: Record<Lang, string> = {
  es: "Español",
  en: "English",
  zh: "中文",
  hi: "हिन्दी",
  ar: "العربية",
  pt: "Português",
  fr: "Français",
  ru: "Русский",
  ja: "日本語",
  de: "Deutsch",
};

export function isRtl(lang: Lang): boolean {
  return lang === "ar";
}

export function isLang(value: unknown): value is Lang {
  return typeof value === "string" && value in dictionaries;
}
