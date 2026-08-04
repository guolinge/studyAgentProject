import type { SettingsResponse, AppSettings, AgentConfig } from "./settingsTypes";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export async function getSettings(): Promise<SettingsResponse> {
  const res = await fetch(`${BASE}/api/settings`);
  if (!res.ok) throw new Error(`加载设置失败: ${res.status}`);
  return res.json();
}

export async function saveSettings(payload: {
  app?: Partial<AppSettings>;
  agents?: AgentConfig;
}): Promise<void> {
  const res = await fetch(`${BASE}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`保存设置失败: ${res.status}`);
}
