"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!isNaN(v) && v > 0) onMaxTokens(v);
        }}
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

  // Fix 1: ref to track the "saved" auto-clear timer
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fix 1: cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  // Fix 4: AbortController to guard setState after unmount
  useEffect(() => {
    const ac = new AbortController();
    getSettings()
      .then(({ app: a, agents: ag }) => {
        if (ac.signal.aborted) return;
        setApp(a);
        setAgents(ag);
        setLoading(false);
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        setError((e as Error).message);
        setLoading(false);
      });
    return () => ac.abort();
  }, []);

  const handleSave = useCallback(async () => {
    if (!app || !agents) return;
    setSaving(true); setError(null);
    try {
      await saveSettings({ app, agents });
      onThemeChange(app.theme);
      setSaved(true);
      // Fix 1: track timer ID so it can be cleared on unmount
      savedTimerRef.current = setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [app, agents, onThemeChange]);

  // Fix 7: patchApp resets "saved" indicator on any user edit
  const patchApp = (patch: Partial<AppSettings>) => {
    setSaved(false);
    setApp((prev) => prev ? { ...prev, ...patch } : prev);
  };

  // Fix 7: patchDefaults resets "saved" indicator on any user edit
  const patchDefaults = (patch: Partial<AgentDefaults>) => {
    setSaved(false);
    setAgents((prev) => prev ? { ...prev, defaults: { ...prev.defaults, ...patch } } : prev);
  };

  // Fix 7: patchOverride resets "saved" indicator on any user edit
  const patchOverride = (role: string, patch: Partial<AgentOverride>) => {
    setSaved(false);
    setAgents((prev) => {
      if (!prev) return prev;
      const ovs = { ...prev.agents, [role]: { ...(prev.agents[role] ?? {}), ...patch } };
      // Clean up undefined fields (empty string / 0 means "use default")
      const cleaned: AgentOverride = {};
      const ov = ovs[role];
      if (ov.model)     cleaned.model     = ov.model;
      if (ov.effort)    cleaned.effort    = ov.effort;
      if (ov.maxTokens) cleaned.maxTokens = ov.maxTokens;
      if (ov.thinking)  cleaned.thinking  = ov.thinking;
      return { ...prev, agents: { ...ovs, [role]: cleaned } };
    });
  };

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
          {/* Fix 3 + Fix 6: type="button" + aria-label */}
          <button type="button" aria-label="关闭" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none px-1">×</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 px-6 gap-6">
          {TAB_LABELS.map(({ id, label }) => (
            // Fix 3: type="button"
            <button
              type="button"
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
                            // Fix 5: fallback to raw role key if label is missing
                            label={AGENT_ROLE_LABELS[role] ?? role}
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
                        // Fix 3: type="button"
                        <button
                          type="button"
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
                    {/* Fix 3 + Fix 6: type="button" + aria-label + aria-pressed */}
                    <button
                      type="button"
                      aria-label="门1 开关"
                      aria-pressed={app.gate1Enabled}
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
          {/* Fix 3: type="button" */}
          <button
            type="button"
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
