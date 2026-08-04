# Config Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Web UI 中添加配置面板（Modal），覆盖模型参数、API Key、飞书文件夹、主题色与行为开关——全部持久化到 `settings.json` 和 `agents.config.json`。

**Architecture:** 后端新增 `src/settingsStore.ts` 存放 AppSettings（API Key、飞书 Token、主题、行为开关），通过 Hono 暴露 `GET/PUT /api/settings`；`buildDeps` 每次 run 时读取 settings，优先级 settings.json > .env。前端通过 ⚙ 按钮打开 Modal，4 个 tab 分类展示配置，保存时分别写回 `settings.json`（app 设置）和 `agents.config.json`（模型参数）；主题通过 CSS 自定义属性 `--accent-*` 实现，`data-theme` 挂在 `<html>` 上。

**Tech Stack:** TypeScript, Zod (schema 验证), Hono (API 路由), React 19, Next.js 16, Tailwind CSS 4 (CSS custom properties for theming)

---

## 文件清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `src/settingsStore.ts` | 新建 | AppSettings Zod schema + load/save（path 可注入，便于测试） |
| `tests/settings.test.ts` | 新建 | settingsStore 单元测试（4 个） |
| `src/server.ts` | 修改 | 新增 GET/PUT /api/settings；buildDeps 读取 settingsStore |
| `web/lib/settingsTypes.ts` | 新建 | 前端 TS 类型（AppSettings、AgentConfig 等） |
| `web/lib/settingsApi.ts` | 新建 | getSettings / saveSettings fetch 工具函数 |
| `web/components/SettingsModal.tsx` | 新建 | 4-tab 设置 Modal 组件 |
| `web/app/globals.css` | 修改 | 追加 5 种主题 CSS 变量 |
| `web/app/page.tsx` | 修改 | 添加 ⚙ 按钮 + Modal 状态 + 主题 effect；替换硬编码 indigo 类 |
| `web/components/HistoryPanel.tsx` | 修改 | 替换硬编码 indigo hover/focus 类 |
| `.gitignore` | 修改 | 追加 `settings.json`（含 API Key，不入 git） |

---

### Task 1: `src/settingsStore.ts` + 单元测试

**Files:**
- Create: `src/settingsStore.ts`
- Create: `tests/settings.test.ts`

- [ ] **Step 1: 先写失败测试**

新建 `tests/settings.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadSettings, saveSettings } from "../src/settingsStore.js";

let tmpDir: string;
let p: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "settings-test-"));
  p = path.join(tmpDir, "settings.json");
});
afterEach(() => { rmSync(tmpDir, { recursive: true }); });

describe("settingsStore", () => {
  it("文件不存在时返回默认值", () => {
    const s = loadSettings(p);
    expect(s.theme).toBe("indigo");
    expect(s.gate1Enabled).toBe(true);
    expect(s.maxReviewRetries).toBe(2);
    expect(s.anthropicApiKey).toBe("");
  });

  it("解析已有配置文件", () => {
    writeFileSync(p, JSON.stringify({ theme: "rose", gate1Enabled: false, anthropicApiKey: "sk-abc" }));
    const s = loadSettings(p);
    expect(s.theme).toBe("rose");
    expect(s.gate1Enabled).toBe(false);
    expect(s.anthropicApiKey).toBe("sk-abc");
  });

  it("合并部分更新并持久化", () => {
    const s1 = saveSettings({ theme: "sky" }, p);
    expect(s1.theme).toBe("sky");
    expect(s1.gate1Enabled).toBe(true);   // 默认值保留
    const s2 = loadSettings(p);
    expect(s2.theme).toBe("sky");          // 已写入磁盘
  });

  it("非法值抛出异常", () => {
    expect(() => saveSettings({ theme: "purple" as never }, p)).toThrow();
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npm test tests/settings.test.ts
```
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `src/settingsStore.ts`**

```ts
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
```

- [ ] **Step 4: 运行测试，确认全部通过**

```bash
npm test tests/settings.test.ts
```
Expected: 4 tests pass

- [ ] **Step 5: 追加 `settings.json` 到 `.gitignore`**

打开 `.gitignore`，末尾追加一行：
```
settings.json
```

- [ ] **Step 6: 提交**

```bash
git add src/settingsStore.ts tests/settings.test.ts .gitignore
git commit -m "feat: add settingsStore (AppSettings schema + load/save)"
```

---

### Task 2: 后端 API 路由 + buildDeps 集成

**Files:**
- Modify: `src/server.ts`

添加内容：① `SETTINGS_PATH` 常量；② `GET /api/settings`；③ `PUT /api/settings`；④ `buildDeps` 从 settingsStore 读取 apiKey / baseURL / indexDoc / gate1 / maxRetries。

- [ ] **Step 1: 在 server.ts 顶部追加新 import**

在现有 import 块末尾追加（注意 `path` 和 `fileURLToPath` 可能已存在，如已存在则跳过对应行）：

```ts
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadSettings, saveSettings } from "./settingsStore.js";
import type { AppSettings } from "./settingsStore.js";
```

同时将现有的：
```ts
import { loadConfig, resolveAgentConfig } from "./config.js";
```
改为：
```ts
import { loadConfig, resolveAgentConfig, ConfigSchema } from "./config.js";
```

- [ ] **Step 2: 在 import 块之后定义 SETTINGS_PATH 常量**

```ts
const SETTINGS_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../settings.json",
);
const AGENTS_CONFIG_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../agents.config.json",
);
```

- [ ] **Step 3: 添加 `GET /api/settings` 路由**

在 `app.get("/health", ...)` 之前插入：

```ts
app.get("/api/settings", (c) => {
  const appSettings = loadSettings(SETTINGS_PATH);
  const agentConfig = loadConfig();
  const masked: AppSettings = {
    ...appSettings,
    anthropicApiKey: appSettings.anthropicApiKey
      ? "••••" + appSettings.anthropicApiKey.slice(-4)
      : "",
  };
  return c.json({ app: masked, agents: agentConfig });
});
```

- [ ] **Step 4: 添加 `PUT /api/settings` 路由**

紧接 GET 路由之后：

```ts
app.put("/api/settings", async (c) => {
  const body = await c.req.json<{ app?: Record<string, unknown>; agents?: unknown }>();

  if (body.app) {
    const patch = { ...(body.app as Partial<AppSettings>) };
    // 前端回传被 mask 的占位符时，不覆盖真实 key
    if (typeof patch.anthropicApiKey === "string" && patch.anthropicApiKey.startsWith("••••")) {
      delete patch.anthropicApiKey;
    }
    saveSettings(patch, SETTINGS_PATH);
  }

  if (body.agents) {
    const cfg = ConfigSchema.parse(body.agents);
    writeFileSync(AGENTS_CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", "utf8");
  }

  return c.json({ ok: true });
});
```

- [ ] **Step 5: 修改 `buildDeps` 函数，使其读取 settingsStore**

在 `buildDeps` 函数开头，将原先的：
```ts
const config = loadConfig();
const sdk = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
});
const modelOverride  = process.env.MODEL_OVERRIDE;
const effortOverride = process.env.EFFORT_OVERRIDE as ResolvedAgentConfig["effort"] | undefined;
const noDiagram      = process.env.NO_DIAGRAM === "1";
const dryRun         = process.env.LARK_DRY_RUN === "1";
```
替换为：
```ts
const config      = loadConfig();
const appSettings = loadSettings(SETTINGS_PATH);

// settings.json 优先，env 兜底
const apiKey  = appSettings.anthropicApiKey  || process.env.ANTHROPIC_API_KEY  || "";
const baseURL = appSettings.anthropicBaseUrl || process.env.ANTHROPIC_BASE_URL || undefined;

const sdk = new Anthropic({ apiKey, baseURL: baseURL || undefined });
const modelOverride  = process.env.MODEL_OVERRIDE;
const effortOverride = process.env.EFFORT_OVERRIDE as ResolvedAgentConfig["effort"] | undefined;
const noDiagram      = process.env.NO_DIAGRAM === "1";
const dryRun         = process.env.LARK_DRY_RUN === "1";
```

将原先的 `const base = process.env.ANTHROPIC_BASE_URL || ""` 这行删除（搜索这行，替换成对 `baseURL` 的直接引用）。

在 `gate` 函数定义处（`const gate = async (title: string, content: string): Promise<string> => {`），加上门1自动通过逻辑：

```ts
const gate = async (title: string, content: string): Promise<string> => {
  // gate1Enabled=false 时，门1自动通过（返回空字符串=通过）
  if (!appSettings.gate1Enabled && title.startsWith("门1")) return "";
  return new Promise((resolve) => {
    const run = runs.get(runId);
    if (!run) { resolve(""); return; }
    run.gateResolver = resolve;
    pushEvent(runId, { type: "gate", title, content });
  });
};
```

将 `search` 相关变量（找 `const base = ...` 后面的 `const search =` 块）中的 `base` 引用改为 `baseURL`：

```ts
const search =
  process.env.NO_SEARCH === "1" || !baseURL
    ? undefined
    : async (query: string) => {
        const r = await tavilySearch(query, { base: baseURL, apiKey });
        return formatSearchContext(r);
      };
```

`dedup` 块中的 `!base` 也改为 `!baseURL`：
```ts
const dedup =
  process.env.NO_DEDUP === "1" || !baseURL
    ? undefined
    : { ... }  // 内部不变
```

将 `indexDocToken` 改为使用 settings：
```ts
const indexDocToken = appSettings.feishuIndexDocToken || process.env.INDEX_DOC_TOKEN;
```
（这行通常已存在，找 `process.env.INDEX_DOC_TOKEN` 直接替换）

在 `return { ... }` 中追加 `reviewMaxRetries`：
```ts
return {
  loadPrompt, runRole, gate, publish, search, dedup, updateIndex,
  onReviewFeedback, patchDocDiagrams,
  reviewMaxRetries: appSettings.maxReviewRetries,
};
```

- [ ] **Step 6: 验证服务器能启动，路由可访问**

```bash
npm run serve &
sleep 2
curl -s http://localhost:3001/api/settings | python3 -m json.tool
# Expected: { "app": { "theme": "indigo", "gate1Enabled": true, ... }, "agents": { "defaults": {...} } }
curl -s -X PUT http://localhost:3001/api/settings \
  -H "Content-Type: application/json" \
  -d '{"app":{"theme":"sky"}}' | python3 -m json.tool
# Expected: { "ok": true }
curl -s http://localhost:3001/api/settings | python3 -m json.tool
# Expected: "theme" 已变为 "sky"
kill %1
# 清理测试产生的 settings.json（或保留，它在 .gitignore 中）
```

- [ ] **Step 7: 全量测试**

```bash
npm test
```
Expected: 90 tests pass（86 原有 + 4 新增 settings 测试）

- [ ] **Step 8: 提交**

```bash
git add src/server.ts
git commit -m "feat: GET/PUT /api/settings; buildDeps reads settingsStore"
```

---

### Task 3: 前端类型定义 + API 客户端

**Files:**
- Create: `web/lib/settingsTypes.ts`
- Create: `web/lib/settingsApi.ts`

- [ ] **Step 1: 新建 `web/lib/settingsTypes.ts`**

```ts
export type ThemeValue = "indigo" | "violet" | "sky" | "emerald" | "rose";
export type EffortValue = "low" | "medium" | "high" | "xhigh" | "max";
export type ThinkingValue = "adaptive" | "disabled";

export interface AppSettings {
  anthropicApiKey:       string;
  anthropicBaseUrl:      string;
  feishuIndexDocToken:   string;
  feishuRootFolderToken: string;
  theme:                 ThemeValue;
  gate1Enabled:          boolean;
  maxReviewRetries:      number;
}

export interface AgentDefaults {
  model:     string;
  effort:    EffortValue;
  maxTokens: number;
  thinking:  ThinkingValue;
}

export interface AgentOverride {
  model?:     string;
  effort?:    EffortValue;
  maxTokens?: number;
  thinking?:  ThinkingValue;
}

export interface AgentConfig {
  defaults: AgentDefaults;
  agents:   Record<string, AgentOverride>;
}

export interface SettingsResponse {
  app:    AppSettings;   // anthropicApiKey 被 mask 为 ••••xxxx
  agents: AgentConfig;
}

export const AGENT_ROLE_LABELS: Record<string, string> = {
  questionAnalysis:    "问题分析",
  contentOrganization: "内容组织",
  contentGeneration:   "内容生成",
  contentReview:       "内容审核",
  diagramSvg:          "SVG 作图",
  incrementalMerge:    "增量合并",
  distiller:           "沉淀",
};

export const EFFORT_OPTIONS: EffortValue[] = ["low", "medium", "high", "xhigh", "max"];
export const THINKING_OPTIONS: ThinkingValue[] = ["adaptive", "disabled"];
export const THEME_OPTIONS: { value: ThemeValue; label: string; rgb: string }[] = [
  { value: "indigo",  label: "靛蓝", rgb: "99 102 241"  },
  { value: "violet",  label: "紫色", rgb: "139 92 246"  },
  { value: "sky",     label: "天蓝", rgb: "14 165 233"  },
  { value: "emerald", label: "翠绿", rgb: "16 185 129"  },
  { value: "rose",    label: "玫瑰", rgb: "244 63 94"   },
];
```

- [ ] **Step 2: 新建 `web/lib/settingsApi.ts`**

```ts
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
```

- [ ] **Step 3: 验证 TS 编译无误**

```bash
cd web && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 4: 提交**

```bash
cd ..
git add web/lib/settingsTypes.ts web/lib/settingsApi.ts
git commit -m "feat: add frontend settings types + API client"
```

---

### Task 4: `web/components/SettingsModal.tsx`

**Files:**
- Create: `web/components/SettingsModal.tsx`

4-tab Modal，本地 state 管理表单，打开时 fetch，保存时 PUT。

- [ ] **Step 1: 新建 `web/components/SettingsModal.tsx`**

```tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { getSettings, saveSettings } from "@/lib/settingsApi";
import type {
  AppSettings, AgentConfig, AgentDefaults, AgentOverride,
  EffortValue, ThinkingValue,
} from "@/lib/settingsTypes";
import {
  AGENT_ROLE_LABELS, EFFORT_OPTIONS, THINKING_OPTIONS, THEME_OPTIONS,
} from "@/lib/settingsTypes";

type Tab = "models" | "external" | "feishu" | "behavior";

const TAB_LABELS: { id: Tab; label: string }[] = [
  { id: "models",   label: "模型配置" },
  { id: "external", label: "外部服务" },
  { id: "feishu",   label: "飞书设置" },
  { id: "behavior", label: "外观 & 行为" },
];

const AGENT_ROLES = Object.keys(AGENT_ROLE_LABELS);

const inputCls =
  "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 outline-none " +
  "focus:border-[rgb(var(--accent-400))] focus:ring-1 focus:ring-[rgb(var(--accent-50))]";

function Field({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {hint && <p className="text-xs text-gray-400 mb-1.5">{hint}</p>}
      {children}
    </div>
  );
}

function AgentRow({
  label, model, effort, maxTokens, thinking, required,
  onModel, onEffort, onMaxTokens, onThinking,
}: {
  label: string; model: string; effort: string;
  maxTokens: number; thinking: string; required: boolean;
  onModel: (v: string) => void; onEffort: (v: string) => void;
  onMaxTokens: (v: number) => void; onThinking: (v: string) => void;
}) {
  const cell =
    "border border-gray-200 rounded-md px-2 py-1.5 text-xs text-gray-700 outline-none bg-white " +
    "focus:border-[rgb(var(--accent-400))]";
  return (
    <div className="grid grid-cols-[96px_1fr_110px_72px_96px] gap-2 items-center py-1">
      <span className="text-xs text-gray-600 font-medium truncate">{label}</span>
      <input type="text" value={model} onChange={(e) => onModel(e.target.value)}
        placeholder={required ? "必填" : "同默认"} className={cell} />
      <select value={effort} onChange={(e) => onEffort(e.target.value)} className={cell}>
        {!required && <option value="">同默认</option>}
        {EFFORT_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
      <input type="number" value={maxTokens || ""} min={1}
        onChange={(e) => onMaxTokens(Number(e.target.value))}
        placeholder={required ? "必填" : "同默"} className={cell} />
      <select value={thinking} onChange={(e) => onThinking(e.target.value)} className={cell}>
        {!required && <option value="">同默认</option>}
        {THINKING_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
    </div>
  );
}

export default function SettingsModal({
  onClose,
  onThemeChange,
}: {
  onClose: () => void;
  onThemeChange: (theme: string) => void;
}) {
  const [tab,     setTab]     = useState<Tab>("models");
  const [app,     setApp]     = useState<AppSettings | null>(null);
  const [agents,  setAgents]  = useState<AgentConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [saved,   setSaved]   = useState(false);

  useEffect(() => {
    getSettings()
      .then(({ app: a, agents: ag }) => { setApp(a); setAgents(ag); setLoading(false); })
      .catch((e) => { setError((e as Error).message); setLoading(false); });
  }, []);

  const handleSave = useCallback(async () => {
    if (!app || !agents) return;
    setSaving(true); setError(null);
    try {
      await saveSettings({ app, agents });
      onThemeChange(app.theme);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [app, agents, onThemeChange]);

  const patchApp = (patch: Partial<AppSettings>) =>
    setApp((prev) => prev ? { ...prev, ...patch } : prev);

  const patchDefaults = (patch: Partial<AgentDefaults>) =>
    setAgents((prev) => prev ? { ...prev, defaults: { ...prev.defaults, ...patch } } : prev);

  const patchOverride = (role: string, patch: Partial<AgentOverride>) =>
    setAgents((prev) => {
      if (!prev) return prev;
      const ovs = { ...prev.agents, [role]: { ...(prev.agents[role] ?? {}), ...patch } };
      // 清理 undefined 字段（空字符串 / 0 表示"用默认"）
      const cleaned: AgentOverride = {};
      const ov = ovs[role];
      if (ov.model)     cleaned.model     = ov.model;
      if (ov.effort)    cleaned.effort    = ov.effort;
      if (ov.maxTokens) cleaned.maxTokens = ov.maxTokens;
      if (ov.thinking)  cleaned.thinking  = ov.thinking;
      return { ...prev, agents: { ...ovs, [role]: cleaned } };
    });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl mx-4 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-800">⚙ 设置</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none px-1">×</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 px-6 gap-6">
          {TAB_LABELS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === id
                  ? "border-[rgb(var(--accent-500))] text-[rgb(var(--accent-500))]"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading && <p className="text-sm text-gray-400 text-center py-8">加载中…</p>}
          {error   && <p className="text-sm text-red-500 mb-4">{error}</p>}

          {!loading && app && agents && (
            <>
              {/* ── 模型配置 ── */}
              {tab === "models" && (
                <div className="space-y-4">
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">全局默认</p>
                    <div className="grid grid-cols-[96px_1fr_110px_72px_96px] gap-2 mb-1">
                      {["角色", "model", "effort", "maxTokens", "thinking"].map((h) => (
                        <span key={h} className="text-[11px] text-gray-400 font-medium">{h}</span>
                      ))}
                    </div>
                    <AgentRow
                      label="默认" model={agents.defaults.model} effort={agents.defaults.effort}
                      maxTokens={agents.defaults.maxTokens} thinking={agents.defaults.thinking}
                      required
                      onModel={(v)     => patchDefaults({ model: v })}
                      onEffort={(v)    => patchDefaults({ effort: v as EffortValue })}
                      onMaxTokens={(v) => patchDefaults({ maxTokens: v })}
                      onThinking={(v)  => patchDefaults({ thinking: v as ThinkingValue })}
                    />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">各角色覆盖（空 = 用默认）</p>
                    <div className="divide-y divide-gray-100">
                      {AGENT_ROLES.map((role) => {
                        const ov = agents.agents[role] ?? {};
                        return (
                          <AgentRow
                            key={role}
                            label={AGENT_ROLE_LABELS[role]}
                            model={ov.model ?? ""} effort={ov.effort ?? ""}
                            maxTokens={ov.maxTokens ?? 0} thinking={ov.thinking ?? ""}
                            required={false}
                            onModel={(v)     => patchOverride(role, { model: v || undefined })}
                            onEffort={(v)    => patchOverride(role, { effort: (v || undefined) as EffortValue | undefined })}
                            onMaxTokens={(v) => patchOverride(role, { maxTokens: v || undefined })}
                            onThinking={(v)  => patchOverride(role, { thinking: (v || undefined) as ThinkingValue | undefined })}
                          />
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* ── 外部服务 ── */}
              {tab === "external" && (
                <div className="space-y-5">
                  <Field label="Anthropic API Key" hint="保存到本地 settings.json，不入 git；留空则使用 .env 中的值">
                    <input type="password" value={app.anthropicApiKey}
                      onChange={(e) => patchApp({ anthropicApiKey: e.target.value })}
                      placeholder="sk-ant-… 或留空" className={inputCls} />
                  </Field>
                  <Field label="网关代理地址 (Base URL)" hint="公司 AI 网关 URL，同时用于 Tavily 搜索代理；留空则直连 Anthropic（搜索不可用）">
                    <input type="text" value={app.anthropicBaseUrl}
                      onChange={(e) => patchApp({ anthropicBaseUrl: e.target.value })}
                      placeholder="https://llm-proxy.example.com" className={inputCls} />
                  </Field>
                </div>
              )}

              {/* ── 飞书设置 ── */}
              {tab === "feishu" && (
                <div className="space-y-5">
                  <Field label="学习文件夹根 Token" hint="飞书文件夹树的根节点 token，lark-cli 刷新文件夹树时从此根扫描">
                    <input type="text" value={app.feishuRootFolderToken}
                      onChange={(e) => patchApp({ feishuRootFolderToken: e.target.value })}
                      placeholder="FldcXXXXXX" className={inputCls} />
                  </Field>
                  <Field label="总索引文档 Token" hint="每次新建文档后，自动追加一行到该文档（不填则跳过）">
                    <input type="text" value={app.feishuIndexDocToken}
                      onChange={(e) => patchApp({ feishuIndexDocToken: e.target.value })}
                      placeholder="doxcnXXXXXX" className={inputCls} />
                  </Field>
                </div>
              )}

              {/* ── 外观 & 行为 ── */}
              {tab === "behavior" && (
                <div className="space-y-6">
                  {/* Theme swatches */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">主题色</label>
                    <div className="flex gap-3">
                      {THEME_OPTIONS.map(({ value, label, rgb }) => (
                        <button
                          key={value}
                          onClick={() => patchApp({ theme: value })}
                          className={`flex flex-col items-center gap-1.5 p-2 rounded-xl border-2 transition-all ${
                            app.theme === value
                              ? "border-[rgb(var(--accent-500))] shadow-sm bg-gray-50"
                              : "border-transparent hover:border-gray-200"
                          }`}
                        >
                          <span className="w-8 h-8 rounded-full" style={{ background: `rgb(${rgb})` }} />
                          <span className="text-xs text-gray-500">{label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Gate1 toggle */}
                  <div className="flex items-center justify-between py-1">
                    <div>
                      <p className="text-sm font-medium text-gray-700">启用门1（范围 / 意图确认）</p>
                      <p className="text-xs text-gray-400 mt-0.5">关闭后门1自动通过，适合明确的简短问题</p>
                    </div>
                    <button
                      onClick={() => patchApp({ gate1Enabled: !app.gate1Enabled })}
                      className={`relative w-11 h-6 rounded-full transition-colors focus:outline-none ${
                        app.gate1Enabled ? "bg-[rgb(var(--accent-500))]" : "bg-gray-300"
                      }`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                        app.gate1Enabled ? "translate-x-5" : "translate-x-0"
                      }`} />
                    </button>
                  </div>

                  {/* maxReviewRetries */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">审核最大重试次数</label>
                    <p className="text-xs text-gray-400 mb-2">内容审核不通过后最多重新生成几次（0 = 不重试，最多 5）</p>
                    <input
                      type="number" min={0} max={5} value={app.maxReviewRetries}
                      onChange={(e) => patchApp({ maxReviewRetries: Math.min(5, Math.max(0, Number(e.target.value))) })}
                      className="w-20 border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-800 outline-none focus:border-[rgb(var(--accent-400))]"
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100">
          <span className="text-xs text-gray-400">设置保存到本地 settings.json（不入 git）</span>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="px-5 py-2 rounded-lg bg-[rgb(var(--accent-500))] hover:brightness-110 disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-semibold transition-all"
          >
            {saving ? "保存中…" : saved ? "✓ 已保存" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TS 编译验证**

```bash
cd web && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 3: 提交**

```bash
cd ..
git add web/components/SettingsModal.tsx
git commit -m "feat: add SettingsModal with 4-tab config UI"
```

---

### Task 5: 主题 CSS 变量 + 顶栏设置按钮 + 接线

**Files:**
- Modify: `web/app/globals.css`
- Modify: `web/app/page.tsx`
- Modify: `web/components/HistoryPanel.tsx`

- [ ] **Step 1: 在 `web/app/globals.css` 末尾追加主题变量**

```css
/* ── Theme accent variables ── */
:root,
[data-theme="indigo"]  { --accent-500: 99 102 241; --accent-400: 129 140 248; --accent-50: 238 242 255; }
[data-theme="violet"]  { --accent-500: 139 92 246; --accent-400: 167 139 250; --accent-50: 245 243 255; }
[data-theme="sky"]     { --accent-500: 14 165 233;  --accent-400: 56 189 248;  --accent-50: 240 249 255; }
[data-theme="emerald"] { --accent-500: 16 185 129;  --accent-400: 52 211 153;  --accent-50: 236 253 245; }
[data-theme="rose"]    { --accent-500: 244 63 94;   --accent-400: 251 113 133; --accent-50: 255 241 242; }
```

- [ ] **Step 2: 修改 `web/app/page.tsx`**

**2a. 在已有 import 行中加入 `useEffect`**

找到：
```tsx
import { useReducer, useRef, useCallback, useState } from "react";
```
改为：
```tsx
import { useReducer, useRef, useCallback, useState, useEffect } from "react";
```

**2b. 追加两个新 import**（在现有 import 块末尾）：
```tsx
import SettingsModal from "@/components/SettingsModal";
import { getSettings } from "@/lib/settingsApi";
```

**2c. 在 `Home()` 内的 state 声明处追加**：
```tsx
const [showSettings, setShowSettings] = useState(false);
```

**2d. 在 state 声明之后加主题 effect**：
```tsx
// 挂载时拉取 theme 并应用
useEffect(() => {
  getSettings()
    .then(({ app }) => { document.documentElement.dataset.theme = app.theme; })
    .catch(() => {});
}, []);
```

**2e. 替换 header 中 `text-indigo-600`**：

找到：
```tsx
<span className="text-indigo-600 font-semibold tracking-wide text-sm">✦ StudyAgent</span>
```
改为：
```tsx
<span className="text-[rgb(var(--accent-500))] font-semibold tracking-wide text-sm">✦ StudyAgent</span>
```

**2f. 在 header 右侧按钮组中添加设置按钮**

找到"↻ 刷新文件夹树"按钮，在其**之前**插入：
```tsx
<button
  onClick={() => setShowSettings(true)}
  className="text-xs text-gray-500 hover:text-gray-700 border border-gray-300 hover:border-gray-400 px-3 py-1.5 rounded-md transition-colors bg-white"
>
  ⚙ 设置
</button>
```

**2g. 替换 textarea 的 focus 颜色类**：

找到 `focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100`，改为：
```
focus:border-[rgb(var(--accent-400))] focus:ring-2 focus:ring-[rgb(var(--accent-50))]
```

**2h. 替换提交按钮背景色**：

找到 `bg-indigo-600 hover:bg-indigo-500`，改为：
```
bg-[rgb(var(--accent-500))] hover:brightness-110
```

**2i. 在 JSX 最外层 `</div>` 前插入 Modal**：
```tsx
{showSettings && (
  <SettingsModal
    onClose={() => setShowSettings(false)}
    onThemeChange={(theme) => {
      document.documentElement.dataset.theme = theme;
    }}
  />
)}
```

- [ ] **Step 3: 修改 `web/components/HistoryPanel.tsx`**

**3a. 新建对话按钮** — 找到：
```
hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600
```
改为：
```
hover:border-[rgb(var(--accent-400))] hover:bg-[rgb(var(--accent-50))] hover:text-[rgb(var(--accent-500))]
```

**3b. 搜索框** — 找到：
```
focus:border-indigo-300 focus:ring-1 focus:ring-indigo-100
```
改为：
```
focus:border-[rgb(var(--accent-400))] focus:ring-1 focus:ring-[rgb(var(--accent-50))]
```

- [ ] **Step 4: TS 编译验证**

```bash
cd web && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 5: 全量测试**

```bash
cd .. && npm test
```
Expected: 90 tests pass

- [ ] **Step 6: 手动验证**

```bash
npm run dev
```

打开 http://localhost:3000，逐项验证：

1. 顶栏出现 **⚙ 设置** 按钮
2. 点击打开 Modal，4 个 tab 可切换
3. **模型配置** tab：显示当前 `agents.config.json` 中的值；修改某 agent 的 effort，点保存，`cat agents.config.json` 确认已写入
4. **外部服务** tab：API Key 显示 `••••xxxx` 形式；填入新值后保存，`cat settings.json` 确认明文写入（非 mask）
5. **飞书设置** tab：填入 token，保存，`cat settings.json` 确认
6. **外观 & 行为** tab：点击不同主题色，UI 颜色立刻随之变化（save 后通过 `onThemeChange` 回调应用）；切换门1 toggle；改 maxRetries
7. 刷新页面，主题颜色保持（effect 在 mount 时重新 fetch 并应用）
8. 点击 Modal 外的遮罩或 × 按钮关闭

- [ ] **Step 7: 提交**

```bash
git add web/app/globals.css web/app/page.tsx web/components/HistoryPanel.tsx
git commit -m "feat: wire up theme CSS vars + settings button + SettingsModal"
```

- [ ] **Step 8: 推送**

```bash
git push origin main
```

---

## 完成后的效果

- `settings.json`（.gitignore 排除）持久化 API Key、飞书 Token、主题、行为开关
- `agents.config.json` 通过 UI 可视化编辑
- 后端 `buildDeps` 每次 run 读取最新 settings，无需重启即可生效
- 主题切换即时生效，刷新页面后持久恢复
- 共 90 个测试全绿
