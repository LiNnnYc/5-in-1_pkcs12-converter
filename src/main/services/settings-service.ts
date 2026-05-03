import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { resolveExeDir } from "../utils/path-resolver";
import { createLogger, type LogLevel } from "../utils/logger";

const log = createLogger("settings");

export type AppSettings = {
  logging: {
    enabled: boolean;
    level: LogLevel;
  };
  locale: "zh-TW" | "en" | "ja";
};

const DEFAULTS: AppSettings = {
  logging: { enabled: true, level: "info" },
  locale: "zh-TW"
};

const VALID_LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];
const VALID_LOCALES: AppSettings["locale"][] = ["zh-TW", "en", "ja"];

function settingsPath(): string {
  return join(resolveExeDir(), "settings.json");
}

function coerce(raw: unknown): AppSettings {
  const out: AppSettings = {
    logging: { ...DEFAULTS.logging },
    locale: DEFAULTS.locale
  };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  if (r.logging && typeof r.logging === "object") {
    const l = r.logging as Record<string, unknown>;
    if (typeof l.enabled === "boolean") out.logging.enabled = l.enabled;
    if (typeof l.level === "string" && VALID_LEVELS.includes(l.level as LogLevel)) {
      out.logging.level = l.level as LogLevel;
    }
  }
  if (typeof r.locale === "string" && VALID_LOCALES.includes(r.locale as AppSettings["locale"])) {
    out.locale = r.locale as AppSettings["locale"];
  }
  return out;
}

let cache: AppSettings | null = null;

export function loadSettings(detectedLocale?: AppSettings["locale"]): AppSettings {
  if (cache) return cache;
  const path = settingsPath();
  if (!existsSync(path)) {
    cache = {
      ...DEFAULTS,
      logging: { ...DEFAULTS.logging },
      locale: detectedLocale ?? DEFAULTS.locale
    };
    return cache;
  }
  try {
    const text = readFileSync(path, "utf8");
    cache = coerce(JSON.parse(text));
  } catch (e) {
    log.warn("loadSettings failed; using defaults", { error: (e as Error).message });
    cache = { ...DEFAULTS, logging: { ...DEFAULTS.logging } };
  }
  return cache;
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const current = loadSettings();
  const next: AppSettings = {
    logging: { ...current.logging, ...(patch.logging ?? {}) },
    locale: patch.locale ?? current.locale
  };
  const validated = coerce(next);
  const path = settingsPath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(validated, null, 2), "utf8");
    renameSync(tmp, path);
    cache = validated;
    log.info("settings saved");
  } catch (e) {
    log.error("settings save failed", undefined, e);
    throw e;
  }
  return validated;
}

export function _resetSettingsCacheForTests(): void {
  cache = null;
}
