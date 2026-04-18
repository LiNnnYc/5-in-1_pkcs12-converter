import { createI18n } from "vue-i18n";
import zhTW from "../locales/zh-TW.json";
import en from "../locales/en.json";

export type MessageSchema = typeof zhTW;

export const i18n = createI18n<[MessageSchema], "zh-TW" | "en">({
  legacy: false,
  locale: "zh-TW",
  fallbackLocale: "en",
  messages: {
    "zh-TW": zhTW,
    en
  }
});
