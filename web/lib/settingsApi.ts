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

export interface ProxyModelEntry { id: string; provider?: string }

export async function getProxyModels(): Promise<ProxyModelEntry[]> {
  const res = await fetch(`${BASE}/api/proxy-models`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `获取模型列表失败: ${res.status}`);
  }
  const data = await res.json() as { data?: { id: string; provider?: string }[] };
  return (data.data ?? []).filter((m) => m.id).map((m) => ({ id: m.id, provider: m.provider }));
}
