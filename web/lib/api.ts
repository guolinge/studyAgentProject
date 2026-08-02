/**
 * api.ts — 与后端 Hono 服务器通信的 HTTP 工具函数
 *
 * BASE_URL 由 NEXT_PUBLIC_API_URL 环境变量决定，默认 http://localhost:3001。
 * 生产部署时改为后端服务的真实地址（如 http://your-server:3001）。
 *
 * openEventStream 使用浏览器原生 EventSource API 建立 SSE 长连接，
 * 返回一个 close 函数，组件卸载或流水线结束时调用以避免内存泄漏。
 */

import type { PipelineEvent } from "./types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export async function startRun(topic: string): Promise<string> {
  const res = await fetch(`${BASE}/api/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic }),
  });
  if (!res.ok) throw new Error(`启动失败: ${res.status}`);
  const { runId } = await res.json();
  return runId as string;
}

export function openEventStream(
  runId: string,
  onEvent: (e: PipelineEvent) => void,
): () => void {
  const es = new EventSource(`${BASE}/api/run/${runId}/events`);
  es.onmessage = (ev) => {
    try {
      onEvent(JSON.parse(ev.data) as PipelineEvent);
    } catch {
      // ignore malformed event
    }
  };
  return () => es.close();
}

export async function submitGate(runId: string, reply: string): Promise<void> {
  await fetch(`${BASE}/api/run/${runId}/gate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reply }),
  });
}

export async function refreshFolderTree(): Promise<{ ok: boolean; updatedAt?: string; reason?: string }> {
  const res = await fetch(`${BASE}/api/folder-tree/refresh`, { method: "POST" });
  return res.json();
}
