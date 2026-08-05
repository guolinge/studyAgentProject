/**
 * server.ts — HTTP 服务器（Hono + @hono/node-server）
 *
 * 职责：
 *   - 装配与 cli.ts 相同的所有流水线依赖（runRole / search / dedup / publish / updateIndex）
 *   - 通过 SSE 把进度事件推给前端
 *   - 通过 Promise resolver 机制把门交互桥接给前端
 *
 * 路由：
 *   POST /api/run                 启动流水线，返回 { runId }
 *   GET  /api/run/:id/events      SSE 进度流
 *   POST /api/run/:id/gate        前端提交门回复，触发 resolver
 *   POST /api/folder-tree/refresh 刷新文件夹树 JSON
 *   GET  /health                  健康检查
 *
 * 环境变量（与 cli.ts 完全一致）：
 *   ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL / LARK_DRY_RUN / NO_SEARCH /
 *   NO_DEDUP / NO_DIAGRAM / INDEX_DOC_TOKEN / MODEL_OVERRIDE / EFFORT_OVERRIDE
 *   PORT（默认 3001）
 */

import "dotenv/config";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { loadConfig, resolveAgentConfig, ConfigSchema } from "./config.js";
import { loadSettings, saveSettings } from "./settingsStore.js";
import type { AppSettings } from "./settingsStore.js";
import { loadPrompt } from "./prompts.js";
import { runAgent, type ModelClient } from "./agentRunner.js";
import {
  larkCreateDoc,
  larkCreateFolder,
  larkUpdateStrReplace,
  larkSearchDocs,
  larkFetchOutline,
  larkFetchDocContent,
  larkBlockInsertAfter,
  larkAppendToDoc,
  type SearchHit,
} from "./tools/lark.js";
import type { PlacementInfo } from "./orchestrator.js";
import { tavilySearch, formatSearchContext } from "./tools/tavily.js";
import { runPipeline } from "./orchestrator.js";
import { patchDiagrams, renderDiagrams, extractDiagramSpecs } from "./diagrams.js";
import { mergeIntoDoc } from "./merge.js";
import { refreshFolderTree } from "./refreshFolderTree.js";
import type { AgentInput, AgentRole, ResolvedAgentConfig } from "./types.js";
import {
  dbCreateRun,
  dbSetDocUrl,
  dbSetDocTitle,
  dbSetStatus,
  dbIncrTotals,
  dbAddStep,
  dbPushEvent,
  dbGetEvents,
  dbGetSteps,
  dbListRuns,
  dbDeleteRun,
} from "./db.js";

// ── 配置文件路径 ───────────────────────────────────────────────────────────────

const SETTINGS_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../settings.json",
);
const AGENTS_CONFIG_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../agents.config.json",
);

// ── SSE 事件类型（与 web/lib/types.ts 保持同步）─────────────────────────────

export interface StepStartEvent    { type: "step_start";      role: AgentRole; label: string }
export interface ProgressEvent     { type: "progress";        role: AgentRole; label: string } // 环节完成 ✓
export interface StepErrorEvent    { type: "step_error";      label: string; message: string }
export interface GateEvent         { type: "gate";            title: string; content: string }
export interface GateClosedEvent   { type: "gate_closed" }
export interface DocCreatedEvent   { type: "doc_created";     url: string; folderName: string }
export interface ReviewFeedbackEvent { type: "review_feedback"; content: string }
export interface StepDeltaEvent    { type: "step_delta";     role: AgentRole; label: string; delta: string }
export interface DoneEvent         { type: "done"; kind: "single" | "split" }
export interface ErrorEvent        { type: "error"; message: string }
export type PipelineEvent =
  | StepStartEvent | ProgressEvent | StepErrorEvent | StepDeltaEvent
  | GateEvent | GateClosedEvent
  | DocCreatedEvent | ReviewFeedbackEvent
  | DoneEvent | ErrorEvent;

// ── RunState ────────────────────────────────────────────────────────────────

interface RunState {
  eventQueue: PipelineEvent[];
  subscribers: Set<(e: PipelineEvent) => void>;
  gateResolver: ((reply: string) => void) | null;
}

const runs = new Map<string, RunState>();

function createRun(topic: string): string {
  const id = randomUUID();
  const createdAt = Date.now();
  runs.set(id, { eventQueue: [], subscribers: new Set(), gateResolver: null });
  dbCreateRun(id, topic, createdAt);
  return id;
}

function pushEvent(id: string, event: PipelineEvent): void {
  const run = runs.get(id);
  if (!run) return;
  const seq = run.eventQueue.length;
  run.eventQueue.push(event);
  dbPushEvent(id, seq, event);
  run.subscribers.forEach((fn) => fn(event));
}

// ── 角色标签（用于进度显示）────────────────────────────────────────────────

const ROLE_LABEL: Record<AgentRole, string> = {
  questionAnalysis:    "问题分析",
  contentOrganization: "内容组织",
  contentGeneration:   "内容生成",
  contentReview:       "内容审核",
  diagramSvg:          "SVG 作图",
  incrementalMerge:    "增量合并",
  distiller:           "沉淀",
};

// ── 装配流水线依赖 ────────────────────────────────────────────────────────────

function buildDeps(runId: string) {
  const config      = loadConfig();
  const appSettings = loadSettings(SETTINGS_PATH);

  const apiKey  = appSettings.anthropicApiKey;
  const baseURL = appSettings.anthropicBaseUrl || undefined;

  const sdk = new Anthropic({ apiKey, baseURL: baseURL || undefined });

  const modelOverride  = process.env.MODEL_OVERRIDE;
  const effortOverride = process.env.EFFORT_OVERRIDE as ResolvedAgentConfig["effort"] | undefined;
  const noDiagram      = process.env.NO_DIAGRAM === "1";
  const dryRun         = process.env.LARK_DRY_RUN === "1";

  const runRole = async (role: AgentRole, input: AgentInput) => {
    const startedAt = Date.now();
    let inputTok = 0, outputTok = 0;
    // 包装 SDK client 以捕获每次 API 调用的 token 用量
    const wrappedClient: ModelClient = {
      createMessage: async (params) => {
        const stream = sdk.messages.stream(params as never);
        // 把每个 text delta 直接推给 SSE 订阅者（不入 DB，不入 eventQueue）
        (stream as any).on("text", (delta: string) => {
          const run = runs.get(runId);
          if (!run) return;
          const e: StepDeltaEvent = { type: "step_delta", role, label: ROLE_LABEL[role], delta };
          run.subscribers.forEach((fn) => fn(e));
        });
        const msg = await (stream.finalMessage() as any);
        inputTok += (msg.usage?.input_tokens ?? 0);
        outputTok += (msg.usage?.output_tokens ?? 0);
        return msg;
      },
    };
    const base = resolveAgentConfig(config, role);
    const cfg: ResolvedAgentConfig = {
      ...base,
      model:  modelOverride  || base.model,
      effort: effortOverride || base.effort,
    };
    pushEvent(runId, { type: "step_start", role, label: ROLE_LABEL[role] });
    const result = await runAgent(input, cfg, wrappedClient);
    const durationMs = Date.now() - startedAt;
    pushEvent(runId, { type: "progress", role, label: ROLE_LABEL[role] });
    dbAddStep(runId, role, ROLE_LABEL[role], inputTok, outputTok, durationMs, startedAt);
    dbIncrTotals(runId, inputTok + outputTok, durationMs);
    return result;
  };

  const search =
    process.env.NO_SEARCH === "1" || !baseURL
      ? undefined
      : async (query: string) => {
          const r = await tavilySearch(query, { base: baseURL, apiKey });
          return formatSearchContext(r);
        };

  const dedup =
    process.env.NO_DEDUP === "1" || !baseURL
      ? undefined
      : {
          search: (kw: string) => larkSearchDocs(kw, { mine: true, onlyTitle: true }),
          merge: async (input: string, target: SearchHit) => {
            const r = await mergeIntoDoc(input, target, {
              loadPrompt,
              runRole,
              fetchOutline: (u) => larkFetchOutline(u),
              insertAfter: (u, b, c) => larkBlockInsertAfter(u, b, c),
            });
            if (!noDiagram) {
              await patchDiagrams(r.incrementalMarkdown, r.url, {
                loadPrompt, runRole,
                updateDoc: (u, p, c) => larkUpdateStrReplace(u, p, c),
                onProgress: () => {},
              });
            }
            return { url: r.url, incrementalMarkdown: r.incrementalMarkdown };
          },
        };

  const indexDocToken = appSettings.feishuIndexDocToken || process.env.INDEX_DOC_TOKEN;
  const updateIndex =
    dryRun || !indexDocToken
      ? undefined
      : async (title: string, url: string) => {
          const date = new Date().toISOString().split("T")[0];
          const row = `| ${title} | [链接](${url}) | ${date} |\n`;
          await larkAppendToDoc(indexDocToken, row);
        };

  const gate = async (title: string, content: string): Promise<string> => {
    // When gate1Enabled=false, gate 1 auto-passes
    if (!appSettings.gate1Enabled && title.startsWith("门1")) return "";
    return new Promise((resolve) => {
      const run = runs.get(runId);
      if (!run) { resolve(""); return; }
      run.gateResolver = resolve;
      pushEvent(runId, { type: "gate", title, content });
    });
  };

  const publish = async (markdown: string, placement: PlacementInfo): Promise<string> => {
    if (dryRun) {
      const md = noDiagram ? markdown : await renderDiagrams(markdown, { loadPrompt, runRole });
      return `(dry-run)\n${md}`;
    }
    let folderToken: string;
    let folderName: string;
    if (placement.type === "new") {
      folderToken = await larkCreateFolder(placement.folderName, placement.parentToken);
      folderName = placement.folderName;
    } else {
      folderToken = placement.folderToken;
      folderName = placement.title; // 已有文件夹时用文档标题作展示名
    }
    const url = await larkCreateDoc(markdown, "markdown", folderToken);

    // 文字写入飞书后立刻通知前端（问题7）
    pushEvent(runId, { type: "doc_created", url, folderName });
    dbSetDocUrl(runId, url, folderName);
    // 异步提取文档标题（首行 H1）并持久化
    const titleMatch = markdown.match(/^#\s+(.+)/m);
    if (titleMatch) dbSetDocTitle(runId, titleMatch[1].trim());

    // 画图 fire-and-forget：不 await，让前端立即拿到链接（问题7）
    if (!noDiagram) {
      patchDiagrams(markdown, url, {
        loadPrompt, runRole,
        updateDoc: (u, p, c) => larkUpdateStrReplace(u, p, c),
        onProgress: () => {},
        onError: (instruction, reason) =>
          pushEvent(runId, {
            type: "step_error",
            label: `SVG 作图：${instruction.slice(0, 40)}`,
            message: reason,
          }),
      }).catch((e) =>
        pushEvent(runId, { type: "step_error", label: "SVG 作图", message: (e as Error).message }),
      );
    }
    return url;
  };

  const onReviewFeedback = (feedback: string) =>
    pushEvent(runId, { type: "review_feedback", content: feedback });

  const patchDocDiagrams = async (docUrl: string) => {
    pushEvent(runId, { type: "step_start", role: "diagramSvg", label: "读取原文档" });
    const content = await larkFetchDocContent(docUrl);
    const specs = extractDiagramSpecs(content);
    pushEvent(runId, { type: "progress", role: "diagramSvg", label: "读取原文档" });
    if (specs.length === 0) {
      throw new Error("文档中未找到【配图指令:...】占位符，无法补画配图");
    }
    pushEvent(runId, { type: "doc_created", url: docUrl, folderName: "（原文档）" });
    dbSetDocUrl(runId, docUrl, "（原文档）");
    const result = await patchDiagrams(content, docUrl, {
      loadPrompt,
      runRole,
      updateDoc: (u, p, c) => larkUpdateStrReplace(u, p, c),
      onProgress: () => {},
      onError: (instruction, reason) =>
        pushEvent(runId, {
          type: "step_error",
          label: `SVG 作图：${instruction.slice(0, 40)}`,
          message: reason,
        }),
    });
    return { url: docUrl, patched: result.patched, total: result.total };
  };

  return { loadPrompt, runRole, gate, publish, search, dedup, updateIndex, onReviewFeedback, patchDocDiagrams, reviewMaxRetries: appSettings.maxReviewRetries };
}

// ── Hono 应用 ─────────────────────────────────────────────────────────────────

const app = new Hono();

app.use("*", cors());

app.get("/api/settings", (c) => {
  const appSettings = loadSettings(SETTINGS_PATH);
  const agentConfig = loadConfig(AGENTS_CONFIG_PATH);
  const masked: AppSettings = {
    ...appSettings,
    anthropicApiKey: appSettings.anthropicApiKey
      ? "••••" + appSettings.anthropicApiKey.slice(-4)
      : "",
  };
  return c.json({ app: masked, agents: agentConfig });
});

app.put("/api/settings", async (c) => {
  let body: { app?: Record<string, unknown>; agents?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }

  try {
    if (body.app) {
      const patch = { ...(body.app as Partial<AppSettings>) };
      if (typeof patch.anthropicApiKey === "string" && patch.anthropicApiKey.startsWith("••••")) {
        delete patch.anthropicApiKey;
      }
      saveSettings(patch, SETTINGS_PATH);
    }

    if (body.agents) {
      const cfg = ConfigSchema.parse(body.agents);
      writeFileSync(AGENTS_CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", "utf8");
    }
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }

  return c.json({ ok: true });
});

app.get("/api/proxy-models", async (c) => {
  const s = loadSettings(SETTINGS_PATH);
  const apiKey = s.anthropicApiKey;
  const baseUrl = s.anthropicBaseUrl;
  if (!apiKey || !baseUrl) {
    return c.json({ error: "请先在设置中填写 API Key 和网关地址" }, 400);
  }
  try {
    const res = await fetch(`${baseUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return c.json({ error: `代理返回 ${res.status}` }, 502);
    return c.json(await res.json());
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

app.get("/health", (c) => c.json({ ok: true }));

// 飞书文档 URL 模式（用于拖拽引用 outline 注入）
const FEISHU_URL_RE = /https?:\/\/[a-z0-9-]+\.feishu\.cn\/\S+/i;

// 启动流水线
app.post("/api/run", async (c) => {
  const { topic } = await c.req.json<{ topic: string }>();
  if (!topic?.trim()) return c.json({ error: "topic required" }, 400);

  const rawTopic = topic.trim();
  const runId = createRun(rawTopic);
  const deps = buildDeps(runId);

  // 后台异步跑，不 await
  (async () => {
    try {
      // 拖拽引用：若 topic 含飞书 URL，预取大纲注入上下文（LLM 据此判断操作类型）
      let userInput = rawTopic;
      const urlMatch = rawTopic.match(FEISHU_URL_RE);
      if (urlMatch) {
        try {
          const outline = await larkFetchOutline(urlMatch[0]);
          if (outline.trim()) {
            userInput = `## 引用文档大纲\n\n${outline}\n\n---\n\n${rawTopic}`;
          }
        } catch {
          // 预取失败不阻断，直接用原始 topic
        }
      }

      const result = await runPipeline(userInput, deps);
      if (result.kind === "split") {
        for (const sub of result.topics) {
          const fixedPlacement = sub.placement;
          const subDeps = {
            ...buildDeps(runId),
            publish: async (markdown: string) => {
              let folderToken: string;
              if (fixedPlacement.type === "new") {
                folderToken = await larkCreateFolder(fixedPlacement.folderName, fixedPlacement.parentToken);
              } else {
                folderToken = fixedPlacement.folderToken;
              }
              const url = await larkCreateDoc(markdown, "markdown", folderToken);
              return url;
            },
          };
          const subResult = await runPipeline(sub.title, subDeps);
          if (subResult.kind === "single") {
            pushEvent(runId, { type: "done", kind: "split" });
          }
        }
      } else {
        pushEvent(runId, { type: "done", kind: "single" });
      }
      dbSetStatus(runId, "done");
    } catch (e) {
      pushEvent(runId, { type: "error", message: (e as Error).message });
      dbSetStatus(runId, "error");
    }
  })();

  return c.json({ runId });
});

// SSE 进度流
app.get("/api/run/:id/events", (c) => {
  const runId = c.req.param("id");
  const run = runs.get(runId);
  if (!run) return c.json({ error: "run not found" }, 404);

  const { readable, writable } = new TransformStream<Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const push = (event: PipelineEvent) => {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    writer.write(encoder.encode(data)).catch(() => {});
  };

  // 回放已缓冲事件（处理 SSE 连接晚于 POST /api/run 的情况）
  for (const e of run.eventQueue) push(e);
  run.subscribers.add(push);

  c.req.raw.signal.addEventListener("abort", () => {
    run.subscribers.delete(push);
    writer.close().catch(() => {});
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection":    "keep-alive",
    },
  });
});

// 前端提交门回复
app.post("/api/run/:id/gate", async (c) => {
  const runId = c.req.param("id");
  const run = runs.get(runId);
  if (!run) return c.json({ error: "run not found" }, 404);
  if (!run.gateResolver) return c.json({ error: "no gate waiting" }, 400);

  const { reply } = await c.req.json<{ reply: string }>();
  const resolver = run.gateResolver;
  run.gateResolver = null;
  resolver(reply ?? "");
  pushEvent(runId, { type: "gate_closed" });
  return c.json({ ok: true });
});

// 历史运行列表（?q= 可关键词搜索）
app.get("/api/history", (c) => {
  const q = c.req.query("q") ?? undefined;
  return c.json(dbListRuns({ q }));
});

// 历史运行详情：事件列表 + 步骤统计
app.get("/api/history/:id", (c) => {
  const id = c.req.param("id");
  return c.json({ events: dbGetEvents(id), steps: dbGetSteps(id) });
});

// 删除历史运行（级联删除事件和步骤）
app.delete("/api/history/:id", (c) => {
  const id = c.req.param("id");
  dbDeleteRun(id);
  return c.json({ ok: true });
});

// 刷新文件夹树
app.post("/api/folder-tree/refresh", async (c) => {
  const result = await refreshFolderTree();
  return c.json(result);
});

// ── 启动 ──────────────────────────────────────────────────────────────────────

const port = Number(process.env.PORT ?? 3001);
console.error(`StudyAgent server starting on http://localhost:${port}`);
serve({ fetch: app.fetch, port });
