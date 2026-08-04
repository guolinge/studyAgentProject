import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { z } from "zod";

export const ThemeValues = ["indigo", "violet", "sky", "emerald", "rose"] as const;

export const AppSettingsSchema = z.object({
  anthropicApiKey:       z.string().default(""),
  anthropicBaseUrl:      z.string().default(""),
  feishuIndexDocToken:   z.string().default(""),
  feishuRootFolderToken: z.string().default(""),
  theme:                 z.enum(ThemeValues).default("indigo"),
  gate1Enabled:          z.boolean().default(true),
  maxReviewRetries:      z.number().int().min(0).max(5).default(2),
});

export type AppSettings = z.infer<typeof AppSettingsSchema>;

export const SETTINGS_DEFAULTS: AppSettings = AppSettingsSchema.parse({});

/** settingsPath 可注入，测试传 tmp 路径，生产传实际路径 */
export function loadSettings(settingsPath: string): AppSettings {
  if (!existsSync(settingsPath)) return { ...SETTINGS_DEFAULTS };
  try {
    const raw = JSON.parse(readFileSync(settingsPath, "utf8"));
    return AppSettingsSchema.parse(raw);
  } catch {
    return { ...SETTINGS_DEFAULTS };
  }
}

export function saveSettings(partial: Partial<AppSettings>, settingsPath: string): AppSettings {
  const current = loadSettings(settingsPath);
  const next = AppSettingsSchema.parse({ ...current, ...partial });
  writeFileSync(settingsPath, JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}
