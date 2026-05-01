import { createI18n } from "vue-i18n";
import zhTW from "../locales/zh-TW.json";
import en from "../locales/en.json";
import ja from "../locales/ja.json";

export type MessageSchema = typeof zhTW;
export type AppLocale = "zh-TW" | "en" | "ja";

export const i18n = createI18n<[MessageSchema], AppLocale>({
  legacy: false,
  locale: "zh-TW",
  fallbackLocale: "en",
  messages: {
    "zh-TW": zhTW,
    en,
    ja
  }
});
