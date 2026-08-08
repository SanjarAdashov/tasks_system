import type { TLanguage } from "../types";

export const getIntlLocale = (language: TLanguage | string): string => {
  if (language === "ru") return "ru-RU";
  if (language === "uz") return "uz-Latn-UZ";
  return language || "en";
};

export const formatLocalizedDate = (value: Date, language: TLanguage | string): string => {
  if (language === "ru" || language === "uz") {
    const parts = new Intl.DateTimeFormat(getIntlLocale(language), {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).formatToParts(value);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
    return `${part("day")}.${part("month")}.${part("year")}`;
  }
  return new Intl.DateTimeFormat(getIntlLocale(language), { dateStyle: "medium" }).format(value);
};
