"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { getSettings, saveSettings, getProxyModels, type ProxyModelEntry } from "@/lib/settingsApi";
import type {
  AppSettings, AgentConfig, AgentDefaults, AgentOverride,
  EffortValue, ThinkingValue, ModelOption,
} from "@/lib/settingsTypes";
import {
  AGENT_ROLE_LABELS, EFFORT_OPTIONS, THINKING_OPTIONS, THEME_OPTIONS, MODEL_OPTIONS,
} from "@/lib/settingsTypes";

const PROVIDER_LABELS: Record<string, string> = {
  aws: "AWS", azure: "Azure", google: "Google",
  volcengine: "火山引擎", dashscope: "DashScope",
  private: "私有部署", huggingface: "HuggingFace",
  openai: "OpenAI", anthropic: "Anthropic", deepseek: "DeepSeek",
};

function buildOptions(entries: ProxyModelEntry[]): ModelOption[] {
  const knownById = new Map(MODEL_OPTIONS.map((m) => [m.id, m]));
  const result: ModelOption[] = [];
  const added = new Set<string>();
  for (const { id, provider: rawProvider } of entries) {
    if (added.has(id)) continue;
    added.add(id);
    if (knownById.has(id)) {
      result.push(knownById.get(id)!);
    } else {
      const slash = id.indexOf("/");
      const idPrefix = slash > 0 ? id.slice(0, slash) : "";
      // 优先用 API 返回的 provider 字段，"system" 是占位值忽略掉
      const providerKey = rawProvider && rawProvider !== "system" ? rawProvider : idPrefix;
      result.push({
        id,
        label: slash > 0 ? id.slice(slash + 1) : id,
        provider: PROVIDER_LABELS[providerKey] ?? (providerKey || "其他"),
      });
    }
  }
  for (const m of MODEL_OPTIONS) {
    if (!added.has(m.id)) result.push(m);
  }
  return result;
}

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

function ModelPicker({ value, options, required, onChange }: {
  value: string;
  options: ModelOption[];
  required: boolean;
  onChange: (v: string) => void;
}) {
  const [open, setOpen]                   = useState(false);
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const [query, setQuery]                 = useState("");
  const wrapRef  = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const grouped = useMemo(
    () => options.reduce<Record<string, ModelOption[]>>((acc, m) => {
      (acc[m.provider] ??= []).push(m);
      return acc;
    }, {}),
    [options],
  );

  const providers = useMemo(() => Object.keys(grouped), [grouped]);

  const filteredModels = useMemo(() => {
    const list = activeProvider ? (grouped[activeProvider] ?? []) : [];
    if (!query) return list;
    const q = query.toLowerCase();
    return list.filter((m) => m.label.toLowerCase().includes(q) || m.id.toLowerCase().includes(q));
  }, [activeProvider, grouped, query]);

  const openPicker = () => {
    if (open) { setOpen(false); return; }
    const current = options.find((m) => m.id === value);
    setActiveProvider(current?.provider ?? providers[0] ?? null);
    setQuery("");
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const select = (id: string) => { onChange(id); setOpen(false); };

  const selected = options.find((m) => m.id === value);
  const displayLabel = selected
    ? selected.label
    : value || (required ? "选择模型…" : "— 同默认 —");

  return (
    <div ref={wrapRef} className="relative min-w-0">
      {/* 触发按钮 */}
      <button
        type="button"
        onClick={openPicker}
        className={
          "w-full flex items-center justify-between gap-1 border rounded-md px-2 py-1.5 text-xs " +
          "bg-white outline-none transition-colors " +
          (open
            ? "border-[rgb(var(--accent-400))] ring-1 ring-[rgb(var(--accent-50))] text-gray-800"
            : "border-gray-200 text-gray-700 hover:border-gray-300")
        }
      >
        <span className="truncate">{displayLabel}</span>
        <svg className={`shrink-0 w-3 h-3 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M2 4l4 4 4-4"/>
        </svg>
      </button>

      {/* 级联面板：左列 provider，右列 models */}
      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 flex bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden"
          style={{ minWidth: "320px" }}>

          {/* 左列：provider 列表 */}
          <div className="w-32 shrink-0 border-r border-gray-100 overflow-y-auto max-h-72 py-1">
            {!required && (
              <button
                type="button"
                onClick={() => select("")}
                className={
                  "w-full text-left px-3 py-2 text-xs border-b border-gray-100 mb-1 " +
                  (!value ? "text-[rgb(var(--accent-500))] font-medium bg-[rgb(var(--accent-50))]" : "text-gray-400 hover:bg-gray-50")
                }
              >
                同默认
              </button>
            )}
            {providers.map((provider) => {
              const isActive = provider === activeProvider;
              const hasSelected = grouped[provider].some((m) => m.id === value);
              return (
                <button
                  key={provider}
                  type="button"
                  onMouseEnter={() => { setActiveProvider(provider); setQuery(""); }}
                  onClick={() => setActiveProvider(provider)}
                  className={
                    "w-full text-left px-3 py-2 text-xs flex items-center justify-between transition-colors " +
                    (isActive
                      ? "bg-[rgb(var(--accent-50))] text-[rgb(var(--accent-500))]"
                      : "text-gray-700 hover:bg-gray-50")
                  }
                >
                  <span className="truncate font-medium">{provider}</span>
                  <span className="flex items-center gap-1 shrink-0">
                    {hasSelected && (
                      <span className="w-1.5 h-1.5 rounded-full bg-[rgb(var(--accent-400))]" />
                    )}
                    <svg className="w-3 h-3 text-gray-300" viewBox="0 0 12 12" fill="none"
                      stroke="currentColor" strokeWidth="1.5">
                      <path d="M4 3l3 3-3 3"/>
                    </svg>
                  </span>
                </button>
              );
            })}
          </div>

          {/* 右列：模型列表 */}
          <div className="flex flex-col flex-1 min-w-0">
            {/* 搜索框 */}
            <div className="px-2 pt-2 pb-1.5 border-b border-gray-100">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索模型…"
                className="w-full text-xs px-2 py-1.5 rounded-lg border border-gray-200 outline-none focus:border-[rgb(var(--accent-400))] bg-gray-50 placeholder-gray-400"
              />
            </div>
            <div className="overflow-y-auto max-h-60 py-1">
              {filteredModels.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-6">
                  {query ? "无匹配结果" : "暂无模型"}
                </p>
              )}
              {filteredModels.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => select(m.id)}
                  className={
                    "w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors " +
                    (value === m.id
                      ? "bg-[rgb(var(--accent-50))] text-[rgb(var(--accent-500))] font-medium"
                      : "text-gray-700 hover:bg-gray-50")
                  }
                >
                  {value === m.id ? (
                    <svg className="shrink-0 w-3 h-3 text-[rgb(var(--accent-400))]" viewBox="0 0 12 12"
                      fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                      <path d="M2 6l3 3 5-5"/>
                    </svg>
                  ) : (
                    <span className="shrink-0 w-3 h-3" />
                  )}
                  <span>{m.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AgentRow({
  label, model, effort, maxTokens, thinking, required, modelOptions,
  onModel, onEffort, onMaxTokens, onThinking,
}: {
  label: string; model: string; effort: string;
  maxTokens: number; thinking: string; required: boolean;
  modelOptions?: ModelOption[];
  onModel: (v: string) => void; onEffort: (v: string) => void;
  onMaxTokens: (v: number) => void; onThinking: (v: string) => void;
}) {
  const cell =
    "border border-gray-200 rounded-md px-2 py-1.5 text-xs text-gray-700 outline-none bg-white " +
    "focus:border-[rgb(var(--accent-400))]";
  const opts = modelOptions ?? MODEL_OPTIONS;
  return (
    <div className="grid grid-cols-[96px_1fr_110px_72px_96px] gap-2 items-center py-1">
      <span className="text-xs text-gray-600 font-medium truncate">{label}</span>
      <ModelPicker value={model} options={opts} required={required} onChange={onModel} />
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
  const [tab,          setTab]          = useState<Tab>("models");
  const [app,          setApp]          = useState<AppSettings | null>(null);
  const [agents,       setAgents]       = useState<AgentConfig | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [saved,        setSaved]        = useState(false);
  const [proxyModels,  setProxyModels]  = useState<ModelOption[] | null>(null);
  const [modelsLoading,setModelsLoading]= useState(false);
  const [modelsError,  setModelsError]  = useState<string | null>(null);

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

  const refreshModels = useCallback(async () => {
    setModelsLoading(true);
    setModelsError(null);
    try {
      const entries = await getProxyModels();
      setProxyModels(buildOptions(entries));
    } catch (e) {
      setModelsError((e as Error).message);
    } finally {
      setModelsLoading(false);
    }
  }, []);

  // Auto-fetch model list when models tab is opened for the first time (stop on error)
  useEffect(() => {
    if (tab === "models" && !proxyModels && !modelsLoading && !modelsError) {
      refreshModels();
    }
  }, [tab, proxyModels, modelsLoading, modelsError, refreshModels]);

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
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl mx-4 h-[680px] max-h-[90vh] flex flex-col"
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
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">全局默认</p>
                      <button
                        type="button"
                        onClick={refreshModels}
                        disabled={modelsLoading}
                        className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50 flex items-center gap-1"
                      >
                        <span className={modelsLoading ? "inline-block animate-spin" : ""}>↻</span>
                        {modelsLoading ? "加载中…" : modelsError ? "重试" : "刷新模型列表"}
                      </button>
                    </div>
                    {modelsError && (
                      <p className="text-xs text-amber-600 mb-2">⚠ {modelsError}（已回退到内置列表）</p>
                    )}
                    <div className="grid grid-cols-[96px_1fr_110px_72px_96px] gap-2 mb-1">
                      {["角色", "model", "effort", "maxTokens", "thinking"].map((h) => (
                        <span key={h} className="text-[11px] text-gray-400 font-medium">{h}</span>
                      ))}
                    </div>
                    <AgentRow
                      label="默认" model={agents.defaults.model} effort={agents.defaults.effort}
                      maxTokens={agents.defaults.maxTokens} thinking={agents.defaults.thinking}
                      required modelOptions={proxyModels ?? undefined}
                      onModel={(v)     => patchDefaults({ model: v })}
                      onEffort={(v)    => patchDefaults({ effort: v as EffortValue })}
                      onMaxTokens={(v) => patchDefaults({ maxTokens: v })}
                      onThinking={(v)  => patchDefaults({ thinking: v as ThinkingValue })}
                    />
                    {/* 价格参考卡片 */}
                    {(() => {
                      const opts = proxyModels ?? MODEL_OPTIONS;
                      const m = opts.find((x) => x.id === agents.defaults.model);
                      return (
                        <div className="mt-2 rounded-lg bg-gray-50 border border-gray-200 px-4 py-2.5 flex items-center gap-4 flex-wrap text-xs">
                          <span className="font-medium text-gray-500">
                            {m ? `${m.provider} · ${m.label}` : (agents.defaults.model || "未选择")}
                          </span>
                          {m?.pricing ? (
                            <>
                              <span className="text-gray-600">
                                输入&nbsp;<span className="font-mono font-semibold text-gray-800">{m.pricing.inputPerM}</span>&nbsp;/ M tokens
                              </span>
                              <span className="text-gray-600">
                                输出&nbsp;<span className="font-mono font-semibold text-gray-800">{m.pricing.outputPerM}</span>&nbsp;/ M tokens
                              </span>
                              <span className="text-gray-400 ml-auto">公开参考价，实际以代理计费为准</span>
                            </>
                          ) : (
                            <span className="text-gray-400">
                              价格请参考{" "}
                              <a href="https://ai.futuoa.com/" target="_blank" rel="noreferrer"
                                className="underline hover:text-gray-600">FUTU AI 平台</a>
                            </span>
                          )}
                        </div>
                      );
                    })()}
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
                            required={false} modelOptions={proxyModels ?? undefined}
                            onModel={(v)     => patchOverride(role, { model: v || undefined })}
                            onEffort={(v)    => patchOverride(role, { effort: (v || undefined) as EffortValue | undefined })}
                            onMaxTokens={(v) => patchOverride(role, { maxTokens: v || undefined })}
                            onThinking={(v)  => patchOverride(role, { thinking: (v || undefined) as ThinkingValue | undefined })}
                          />
                        );
                      })}
                    </div>
                  </div>
                  {/* 价格参考链接 */}
                  <div className="pt-1 border-t border-gray-100 flex items-center justify-end gap-4">
                    <a
                      href="https://llm-proxy.futuoa.com/doc"
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-gray-400 hover:text-[rgb(var(--accent-500))] transition-colors"
                    >
                      代理网关文档 ↗
                    </a>
                    <a
                      href="https://ai.futuoa.com/dashboard/model-price"
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-gray-400 hover:text-[rgb(var(--accent-500))] transition-colors"
                    >
                      模型价格参考 ↗
                    </a>
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

                  {/* SVG 画图开关 */}
                  <div className="flex items-center justify-between py-1">
                    <div>
                      <p className="text-sm font-medium text-gray-700">SVG 画图</p>
                      <p className="text-xs text-gray-400 mt-0.5">关闭时用字符图（更快更省 token）；开启后画飞书画板 SVG</p>
                    </div>
                    <button
                      type="button"
                      aria-label="SVG 画图开关"
                      aria-pressed={app.svgDiagram}
                      onClick={() => patchApp({ svgDiagram: !app.svgDiagram })}
                      className={`relative w-11 h-6 rounded-full transition-colors focus:outline-none ${
                        app.svgDiagram ? "bg-[rgb(var(--accent-500))]" : "bg-gray-300"
                      }`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                        app.svgDiagram ? "translate-x-5" : "translate-x-0"
                      }`} />
                    </button>
                  </div>

                  {/* 复制大纲：联网研究含量 */}
                  <div className="py-1">
                    <p className="text-sm font-medium text-gray-700">复制大纲 · 联网研究含量</p>
                    <p className="text-xs text-gray-400 mt-0.5 mb-2">「复制大纲」bundle 里研究资料的多少（中台自己也能联网搜）</p>
                    <div className="flex gap-1">
                      {([
                        { v: "full", label: "全部" },
                        { v: "digest", label: "精简" },
                        { v: "none", label: "不含" },
                      ] as const).map((opt) => (
                        <button
                          key={opt.v}
                          type="button"
                          onClick={() => patchApp({ bundleResearch: opt.v })}
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                            app.bundleResearch === opt.v
                              ? "bg-[rgb(var(--accent-500))] text-white"
                              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
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
