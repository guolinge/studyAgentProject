"use client";

/**
 * page.tsx — StudyAgent 主页面
 *
 * 状态机（useReducer）驱动整个流程：
 *   idle    → 等待用户输入
 *   running → 已提交，SSE 连接活跃，等待进度事件 / 门交互
 *   done    → 流水线成功结束（至少一个 done 事件）
 *   error   → 流水线异常结束
 *
 * 核心流程：
 *   1. 用户提交主题 → startRun() → 获得 runId
 *   2. openEventStream(runId) → SSE 长连接，dispatch EVENT 驱动 ProgressLog 渲染
 *   3. 收到 gate 事件 → ProgressLog 内嵌 GateCard，用户填写后调 onGateSubmit
 *   4. onGateSubmit → submitGate(runId, reply) → 后端 resolver 被触发，流水线继续
 *   5. 收到 done/error 事件 → 关闭 SSE，更新 status
 *
 * SSE 连接引用存在 closeSSERef，确保 done/error 后立即关闭，不泄漏。
 */

import { useReducer, useRef, useCallback } from "react";
import ProgressLog from "@/components/ProgressLog";
import { startRun, openEventStream, submitGate, refreshFolderTree } from "@/lib/api";
import type { PipelineEvent } from "@/lib/types";

// ── 状态机 ─────────────────────────────────────────────────────────────────

type Status = "idle" | "running" | "done" | "error";

interface State {
  status: Status;
  runId: string | null;
  events: PipelineEvent[];
  refreshMsg: string;
}

type Action =
  | { type: "START"; runId: string }
  | { type: "EVENT"; event: PipelineEvent }
  | { type: "DONE" }
  | { type: "ERROR" }
  | { type: "REFRESH_MSG"; msg: string }
  | { type: "RESET" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "START":
      return { ...state, status: "running", runId: action.runId, events: [] };
    case "EVENT":
      return { ...state, events: [...state.events, action.event] };
    case "DONE":
      return { ...state, status: "done" };
    case "ERROR":
      return { ...state, status: "error" };
    case "REFRESH_MSG":
      return { ...state, refreshMsg: action.msg };
    case "RESET":
      return { status: "idle", runId: null, events: [], refreshMsg: "" };
    default:
      return state;
  }
}

const INIT: State = { status: "idle", runId: null, events: [], refreshMsg: "" };

// ── 页面 ──────────────────────────────────────────────────────────────────

export default function Home() {
  const [state, dispatch] = useReducer(reducer, INIT);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const closeSSERef = useRef<(() => void) | null>(null);

  const handleSubmit = useCallback(async () => {
    const topic = textareaRef.current?.value.trim() ?? "";
    if (!topic || state.status === "running") return;

    try {
      const runId = await startRun(topic);
      dispatch({ type: "START", runId });

      closeSSERef.current = openEventStream(runId, (event) => {
        dispatch({ type: "EVENT", event });
        if (event.type === "done" || event.type === "error") {
          closeSSERef.current?.();
          dispatch({ type: event.type === "done" ? "DONE" : "ERROR" });
        }
      });
    } catch (e) {
      dispatch({ type: "EVENT", event: { type: "error", message: (e as Error).message } });
      dispatch({ type: "ERROR" });
    }
  }, [state.status]);

  const handleGateSubmit = useCallback(async (reply: string) => {
    if (!state.runId) return;
    await submitGate(state.runId, reply);
  }, [state.runId]);

  const handleRefresh = useCallback(async () => {
    dispatch({ type: "REFRESH_MSG", msg: "刷新中…" });
    try {
      const result = await refreshFolderTree();
      dispatch({
        type: "REFRESH_MSG",
        msg: result.ok ? `✓ 已更新 (${result.updatedAt})` : `✗ ${result.reason}`,
      });
    } catch {
      dispatch({ type: "REFRESH_MSG", msg: "✗ 请求失败" });
    }
    setTimeout(() => dispatch({ type: "REFRESH_MSG", msg: "" }), 3000);
  }, []);

  const isRunning = state.status === "running";

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200 flex flex-col">
      {/* 顶栏 */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-zinc-900 bg-zinc-950/80 backdrop-blur sticky top-0 z-10">
        <span className="text-indigo-400 font-semibold tracking-wide">✦ StudyAgent</span>
        <div className="flex items-center gap-3">
          {state.refreshMsg && (
            <span className="text-xs text-zinc-500">{state.refreshMsg}</span>
          )}
          <button
            onClick={handleRefresh}
            className="text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-800 hover:border-zinc-600 px-3 py-1.5 rounded-md transition-colors"
          >
            ↻ 刷新文件夹树
          </button>
        </div>
      </header>

      {/* 主体 */}
      <main className="flex-1 flex flex-col items-center px-6 py-12 max-w-2xl w-full mx-auto">
        {/* 输入区 */}
        <div className="w-full mb-10">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-[11px] tracking-widest uppercase text-zinc-600">输入内容</span>
            <div className="flex gap-1.5">
              {["短问题", "问题 + 答案", "链接"].map((tag) => (
                <span key={tag} className="text-[10px] text-zinc-600 border border-zinc-800 rounded px-2 py-0.5">
                  {tag}
                </span>
              ))}
            </div>
          </div>

          <textarea
            ref={textareaRef}
            rows={5}
            disabled={isRunning}
            placeholder={"支持三种输入方式：\n\n① 短问题：pnpm 的原理是什么\n\n② 问题 + AI 回答（整理/拓展）\n\n③ 链接（微信公众号、网页等）"}
            className="w-full bg-zinc-900 border border-zinc-800 focus:border-indigo-500/40 rounded-xl text-sm text-zinc-200 placeholder-zinc-700 px-4 py-3.5 outline-none resize-y leading-relaxed min-h-[120px] transition-colors disabled:opacity-50"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />

          <div className="flex items-center justify-between mt-2.5">
            <span className="text-[11px] text-zinc-700">Shift+Enter 换行 · Enter 提交</span>
            <div className="flex gap-2">
              {(state.status === "done" || state.status === "error") && (
                <button
                  onClick={() => dispatch({ type: "RESET" })}
                  className="px-4 py-2 rounded-lg text-sm text-zinc-400 border border-zinc-700 hover:border-zinc-500 transition-colors"
                >
                  重置
                </button>
              )}
              <button
                onClick={handleSubmit}
                disabled={isRunning}
                className="px-5 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-white text-sm font-semibold transition-colors"
              >
                {isRunning ? (
                  <span className="flex items-center gap-2">
                    <span className="inline-block animate-spin">◌</span> 生成中
                  </span>
                ) : (
                  "生成 →"
                )}
              </button>
            </div>
          </div>
        </div>

        {/* 进度日志 */}
        <ProgressLog events={state.events} onGateSubmit={handleGateSubmit} runId={state.runId} />
      </main>
    </div>
  );
}
