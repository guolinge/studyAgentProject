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
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { loadConfig, resolveAgentConfig } from "./config.js";
import { loadPrompt } from "./prompts.js";
import { runAgent, type ModelClient } from "./agentRunner.js";
import {
  larkCreateDoc,
  larkCreateFolder,
  larkUpdateStrReplace,
  larkSearchDocs,
  larkFetchOutline,
  larkBlockInsertAfter,
  larkAppendToDoc,
  type SearchHit,
} from "./tools/lark.js";
import type { PlacementInfo } from "./orchestrator.js";
import { tavilySearch, formatSearchContext } from "./tools/tavily.js";
import { runPipeline } from "./orchestrator.js";
import { patchDiagrams, renderDiagrams } from "./diagrams.js";
import { mergeIntoDoc } from "./merge.js";
import { refreshFolderTree } from "./refreshFolderTree.js";
import type { AgentInput, AgentRole, ResolvedAgentConfig } from "./types.js";

// ── SSE 事件类型（与 web/lib/types.ts 保持同步）─────────────────────────────

export interface StepStartEvent    { type: "step_start";      role: AgentRole; label: string }
export interface ProgressEvent     { type: "progress";        role: AgentRole; label: string } // 环节完成 ✓
export interface StepErrorEvent    { type: "step_error";      label: string; message: string }
export interface GateEvent         { type: "gate";            title: string; content: string }
export interface GateClosedEvent   { type: "gate_closed" }
export interface DocCreatedEvent   { type: "doc_created";     url: string; folderName: string }
export interface ReviewFeedbackEvent { type: "review_feedback"; content: string }
export interface DoneEvent         { type: "done"; kind: "single" | "split" }
export interface ErrorEvent        { type: "error"; message: string }
export type PipelineEvent =
  | StepStartEvent | ProgressEvent | StepErrorEvent
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

function createRun(): string {
  const id = randomUUID();
  runs.set(id, { eventQueue: [], subscribers: new Set(), gateResolver: null });
  return id;
}

function pushEvent(id: string, event: PipelineEvent): void {
  const run = runs.get(id);
  if (!run) return;
  run.eventQueue.push(event);
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
  const config = loadConfig();
  const sdk = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
  });
  const client: ModelClient = {
    createMessage: (params) => sdk.messages.stream(params as never).finalMessage() as never,
  };

  const modelOverride  = process.env.MODEL_OVERRIDE;
  const effortOverride = process.env.EFFORT_OVERRIDE as ResolvedAgentConfig["effort"] | undefined;
  const noDiagram      = process.env.NO_DIAGRAM === "1";
  const dryRun         = process.env.LARK_DRY_RUN === "1";

  const runRole = async (role: AgentRole, input: AgentInput) => {
    const base = resolveAgentConfig(config, role);
    const cfg: ResolvedAgentConfig = {
      ...base,
      model:  modelOverride  || base.model,
      effort: effortOverride || base.effort,
    };
    pushEvent(runId, { type: "step_start", role, label: ROLE_LABEL[role] }); // 环节开始
    const result = await runAgent(input, cfg, client);
    pushEvent(runId, { type: "progress", role, label: ROLE_LABEL[role] });   // 环节完成
    return result;
  };

  const base = process.env.ANTHROPIC_BASE_URL || "";
  const search =
    process.env.NO_SEARCH === "1" || !base
      ? undefined
      : async (query: string) => {
          const r = await tavilySearch(query, { base, apiKey: process.env.ANTHROPIC_API_KEY ?? "" });
          return formatSearchContext(r);
        };

  const dedup =
    process.env.NO_DEDUP === "1" || !base
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

  const indexDocToken = process.env.INDEX_DOC_TOKEN;
  const updateIndex =
    dryRun || !indexDocToken
      ? undefined
      : async (title: string, url: string) => {
          const date = new Date().toISOString().split("T")[0];
          const row = `| ${title} | [链接](${url}) | ${date} |\n`;
          await larkAppendToDoc(indexDocToken, row);
        };

  const gate = async (title: string, content: string): Promise<string> => {
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

  return { loadPrompt, runRole, gate, publish, search, dedup, updateIndex, onReviewFeedback };
}

// ── Hono 应用 ─────────────────────────────────────────────────────────────────

const app = new Hono();

app.use("*", cors());

app.get("/health", (c) => c.json({ ok: true }));

// 启动流水线
app.post("/api/run", async (c) => {
  const { topic } = await c.req.json<{ topic: string }>();
  if (!topic?.trim()) return c.json({ error: "topic required" }, 400);

  const runId = createRun();
  const deps = buildDeps(runId);

  // 后台异步跑，不 await
  (async () => {
    try {
      const result = await runPipeline(topic.trim(), deps);
      if (result.kind === "split") {
        // 逐篇跑子流水线
        for (const topic of result.topics) {
          const fixedPlacement = topic.placement;
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
          const sub = await runPipeline(topic.title, subDeps);
          if (sub.kind === "single") {
            pushEvent(runId, { type: "done", kind: "split" });
          }
        }
      } else {
        pushEvent(runId, { type: "done", kind: "single" });
      }
    } catch (e) {
      pushEvent(runId, { type: "error", message: (e as Error).message });
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

// 刷新文件夹树
app.post("/api/folder-tree/refresh", async (c) => {
  const result = await refreshFolderTree();
  return c.json(result);
});

// ── 启动 ──────────────────────────────────────────────────────────────────────

const port = Number(process.env.PORT ?? 3001);
console.error(`StudyAgent server starting on http://localhost:${port}`);
serve({ fetch: app.fetch, port });
