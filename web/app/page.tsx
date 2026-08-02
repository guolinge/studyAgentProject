"use client";

/**
 * page.tsx — StudyAgent 主页面（三栏布局）
 *
 * LEFT  240px  历史面板（HistoryPanel）
 * CENTER flex  输入框 + 文档卡片 + GateViewer + 尾部事件
 * RIGHT 240px  步骤侧边栏（StepsSidebar）
 *
 * 状态：
 *   当前运行  status / runId / events / docUrl / docFolder
 *   历史查看  viewRunId / viewEvents / viewSteps / viewDocUrl / viewDocFolder
 *   门选择    selectedGate（{ title, content } | null）
 *   历史刷新  historyTick（新 run 完成后递增，触发 HistoryPanel 重拉）
 */

import { useReducer, useRef, useCallback } from "react";
import HistoryPanel from "@/components/HistoryPanel";
import StepsSidebar from "@/components/StepsSidebar";
import GateViewer from "@/components/GateViewer";
import { startRun, openEventStream, submitGate, refreshFolderTree, getRunDetail } from "@/lib/api";
import type { PipelineEvent, GateEvent, HistoryItem, StepStat } from "@/lib/types";

type Status = "idle" | "running" | "done" | "error";

interface SelectedGate { title: string; content: string }

interface State {
  // 当前运行
  status: Status;
  runId: string | null;
  events: PipelineEvent[];
  docUrl: string | null;
  docFolder: string | null;
  // 历史查看
  viewRunId: string | null;
  viewEvents: PipelineEvent[];
  viewSteps: StepStat[];
  viewDocUrl: string | null;
  viewDocFolder: string | null;
  viewDocTitle: string | null;
  // 门选择（点击右栏门条目）
  selectedGate: SelectedGate | null;
  // 历史面板刷新触发器
  historyTick: number;
  // 刷新文件夹树消息
  refreshMsg: string;
}

type Action =
  | { type: "START"; runId: string }
  | { type: "EVENT"; event: PipelineEvent }
  | { type: "DOC_CREATED"; url: string; folderName: string }
  | { type: "DONE" }
  | { type: "ERROR" }
  | { type: "REFRESH_MSG"; msg: string }
  | { type: "RESET" }
  | { type: "SELECT_GATE"; gate: SelectedGate | null }
  | { type: "VIEW_RUN"; runId: string; events: PipelineEvent[]; steps: StepStat[]; item: HistoryItem }
  | { type: "CLEAR_VIEW" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "START":
      return {
        ...state,
        status: "running",
        runId: action.runId,
        events: [],
        docUrl: null,
        docFolder: null,
        viewRunId: null,
        viewEvents: [],
        viewSteps: [],
        viewDocUrl: null,
        viewDocFolder: null,
        viewDocTitle: null,
        selectedGate: null,
      };
    case "EVENT":
      return { ...state, events: [...state.events, action.event] };
    case "DOC_CREATED":
      return { ...state, docUrl: action.url, docFolder: action.folderName };
    case "DONE":
      return { ...state, status: "done", historyTick: state.historyTick + 1 };
    case "ERROR":
      return { ...state, status: "error", historyTick: state.historyTick + 1 };
    case "REFRESH_MSG":
      return { ...state, refreshMsg: action.msg };
    case "RESET":
      return {
        ...INIT,
        historyTick: state.historyTick + 1,
      };
    case "SELECT_GATE":
      return { ...state, selectedGate: action.gate };
    case "VIEW_RUN":
      return {
        ...state,
        viewRunId: action.runId,
        viewEvents: action.events,
        viewSteps: action.steps,
        viewDocUrl: action.item.docUrl,
        viewDocFolder: action.item.docFolder,
        viewDocTitle: action.item.docTitle,
        selectedGate: null,
      };
    case "CLEAR_VIEW":
      return {
        ...state,
        viewRunId: null,
        viewEvents: [],
        viewSteps: [],
        viewDocUrl: null,
        viewDocFolder: null,
        viewDocTitle: null,
        selectedGate: null,
      };
    default:
      return state;
  }
}

const INIT: State = {
  status: "idle",
  runId: null,
  events: [],
  docUrl: null,
  docFolder: null,
  viewRunId: null,
  viewEvents: [],
  viewSteps: [],
  viewDocUrl: null,
  viewDocFolder: null,
  viewDocTitle: null,
  selectedGate: null,
  historyTick: 0,
  refreshMsg: "",
};

// 从 events 中提取 active gate（最后一个尚未 closed 的 gate 事件）
function getActiveGate(events: PipelineEvent[]): GateEvent | null {
  let last: GateEvent | null = null;
  let closed = false;
  for (const e of events) {
    if (e.type === "gate") { last = e; closed = false; }
    if (e.type === "gate_closed") closed = true;
  }
  return closed ? null : last;
}

// 从 events 中过滤出中间列底部需要显示的事件（review_feedback / done / error）
function getTailEvents(events: PipelineEvent[]) {
  return events.filter(
    (e) => e.type === "review_feedback" || e.type === "done" || e.type === "error",
  );
}

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
        if (event.type === "doc_created") {
          dispatch({ type: "DOC_CREATED", url: event.url, folderName: event.folderName });
        }
        dispatch({ type: "EVENT", event });
        if (event.type === "done") {
          closeSSERef.current?.();
          dispatch({ type: "DONE" });
        } else if (event.type === "error") {
          closeSSERef.current?.();
          dispatch({ type: "ERROR" });
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
    dispatch({ type: "SELECT_GATE", gate: null });
  }, [state.runId]);

  const handleRefresh = useCallback(async () => {
    dispatch({ type: "REFRESH_MSG", msg: "刷新中…" });
    try {
      const result = await refreshFolderTree();
      dispatch({ type: "REFRESH_MSG", msg: result.ok ? `✓ 已更新 (${result.updatedAt})` : `✗ ${result.reason}` });
    } catch {
      dispatch({ type: "REFRESH_MSG", msg: "✗ 请求失败" });
    }
    setTimeout(() => dispatch({ type: "REFRESH_MSG", msg: "" }), 3000);
  }, []);

  const handleSelectRun = useCallback(async (item: HistoryItem) => {
    try {
      const detail = await getRunDetail(item.id);
      dispatch({ type: "VIEW_RUN", runId: item.id, events: detail.events, steps: detail.steps, item });
    } catch {
      // ignore fetch errors
    }
  }, []);

  const handleSelectGate = useCallback((title: string, content: string) => {
    dispatch({ type: "SELECT_GATE", gate: { title, content } });
  }, []);

  // 拖拽引用：从 dataTransfer 取 { topic, docUrl } 追加到 textarea
  const handleDrop = useCallback((e: React.DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    try {
      const raw = e.dataTransfer.getData("text/plain");
      const { topic, docUrl } = JSON.parse(raw) as { topic: string; docUrl: string | null };
      const ref = docUrl
        ? `\n\n📎 引用: ${topic}\n${docUrl}`
        : `\n\n📎 引用: ${topic}`;
      if (textareaRef.current) {
        textareaRef.current.value += ref;
        textareaRef.current.focus();
      }
    } catch {
      // non-JSON drop, ignore
    }
  }, []);

  const isRunning = state.status === "running";
  const isViewMode = state.viewRunId !== null;

  // 右栏和中间列使用的事件源
  const activeEvents = isViewMode ? state.viewEvents : state.events;
  const activeSteps = isViewMode ? state.viewSteps : undefined;
  const activeDocUrl = isViewMode ? state.viewDocUrl : state.docUrl;
  const activeDocFolder = isViewMode ? state.viewDocFolder : state.docFolder;
  const activeDocTitle = isViewMode ? state.viewDocTitle : null;

  // active gate for center column
  const activeGate = isViewMode ? null : getActiveGate(state.events);
  const displayGate: GateEvent | null = state.selectedGate
    ? { type: "gate", title: state.selectedGate.title, content: state.selectedGate.content }
    : activeGate;
  const gateReadOnly = state.selectedGate !== null;

  const tailEvents = getTailEvents(isViewMode ? state.viewEvents : state.events);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-gray-50 text-gray-900">
      {/* 顶栏 */}
      <header className="flex-shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-gray-200 bg-white z-10 shadow-sm">
        <span className="text-indigo-600 font-semibold tracking-wide text-sm">✦ StudyAgent</span>
        <div className="flex items-center gap-3">
          {state.refreshMsg && (
            <span className="text-xs text-gray-500">{state.refreshMsg}</span>
          )}
          <button
            onClick={handleRefresh}
            className="text-xs text-gray-500 hover:text-gray-700 border border-gray-300 hover:border-gray-400 px-3 py-1.5 rounded-md transition-colors bg-white"
          >
            ↻ 刷新文件夹树
          </button>
        </div>
      </header>

      {/* 三栏主体 */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT — 历史面板 */}
        <HistoryPanel
          activeRunId={state.runId}
          viewRunId={state.viewRunId}
          onNewConversation={() => dispatch({ type: "CLEAR_VIEW" })}
          onSelectRun={handleSelectRun}
          refreshTick={state.historyTick}
        />

        {/* CENTER — 输入 + 文档 + 门 + 尾部事件 */}
        <main className="flex-1 overflow-y-auto px-6 py-8 flex flex-col gap-5 min-w-0">
          {/* 输入区（只有非查看模式才活跃提交） */}
          <div className="w-full max-w-2xl mx-auto">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium tracking-widest uppercase text-gray-400">
                {isViewMode ? "查看历史" : "输入内容"}
              </span>
              {!isViewMode && (
                <div className="flex gap-1.5">
                  {["短问题", "问题 + 答案", "链接"].map((tag) => (
                    <span key={tag} className="text-[11px] text-gray-400 border border-gray-200 rounded px-2 py-0.5 bg-white">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <textarea
              ref={textareaRef}
              rows={5}
              disabled={isRunning}
              placeholder={"支持三种输入方式：\n\n① 短问题：pnpm 的原理是什么\n\n② 问题 + AI 回答（整理/拓展）\n\n③ 链接（微信公众号、网页等）"}
              className="w-full bg-white border border-gray-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 rounded-xl text-sm text-gray-800 placeholder-gray-400 px-4 py-3.5 outline-none resize-y leading-relaxed min-h-[120px] transition-all disabled:bg-gray-50 disabled:text-gray-400 shadow-sm"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !isViewMode) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />

            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-gray-400">
                {isViewMode ? "拖拽历史条目到输入框以引用" : "Shift+Enter 换行 · Enter 提交 · 可拖拽历史引用"}
              </span>
              <div className="flex gap-2">
                {(state.status === "done" || state.status === "error") && !isViewMode && (
                  <button
                    onClick={() => dispatch({ type: "RESET" })}
                    className="px-4 py-2 rounded-lg text-sm text-gray-500 border border-gray-300 hover:border-gray-400 hover:text-gray-700 transition-colors bg-white"
                  >
                    重置
                  </button>
                )}
                {!isViewMode && (
                  <button
                    onClick={handleSubmit}
                    disabled={isRunning}
                    className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-semibold transition-colors shadow-sm"
                  >
                    {isRunning ? (
                      <span className="flex items-center gap-2">
                        <span className="inline-block animate-spin">◌</span> 生成中
                      </span>
                    ) : "生成 →"}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 飞书文档卡片 */}
          {(isRunning || state.status === "done" || isViewMode) && (
            <div className="w-full max-w-2xl mx-auto border border-gray-200 rounded-xl bg-white p-4 shadow-sm flex items-center gap-3">
              <span className="text-lg">📄</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-400 mb-0.5">飞书文档</p>
                {activeDocUrl ? (
                  <>
                    {activeDocTitle && (
                      <p className="text-sm text-gray-700 font-medium truncate mb-0.5">{activeDocTitle}</p>
                    )}
                    <a
                      href={activeDocUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-indigo-600 text-sm hover:underline break-all leading-snug"
                    >
                      {activeDocUrl}
                    </a>
                    {activeDocFolder && (
                      <p className="text-xs text-gray-400 mt-0.5">📁 {activeDocFolder}</p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-gray-400 flex items-center gap-2">
                    {isViewMode ? "暂无文档" : <><span className="inline-block animate-spin">◌</span> 写入中…</>}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* 门查看区 */}
          {displayGate && (
            <div className="w-full max-w-2xl mx-auto">
              <GateViewer
                event={displayGate}
                onSubmit={gateReadOnly ? undefined : handleGateSubmit}
                readOnly={gateReadOnly || isViewMode}
              />
            </div>
          )}

          {/* 尾部事件（review_feedback / done / error） */}
          {tailEvents.length > 0 && (
            <div className="w-full max-w-2xl mx-auto space-y-2">
              {tailEvents.map((e, i) => {
                if (e.type === "review_feedback") {
                  return (
                    <div key={i} className="border border-amber-200 rounded-xl bg-amber-50 p-4">
                      <p className="text-xs text-amber-700 font-semibold mb-2">⚠ 审核意见（内容生成将重跑）</p>
                      <pre className="text-sm text-amber-800 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto font-sans">
                        {e.content}
                      </pre>
                    </div>
                  );
                }
                if (e.type === "done") {
                  return (
                    <div key={i} className="flex items-center gap-2 px-3 py-2 text-sm text-emerald-600 font-medium">
                      <span>✅</span> 流水线完成
                    </div>
                  );
                }
                if (e.type === "error") {
                  return (
                    <div key={i} className="border border-red-200 rounded-xl bg-red-50 p-4">
                      <p className="text-xs text-red-600 font-semibold mb-1">❌ 出错</p>
                      <p className="text-sm text-red-700">{e.message}</p>
                    </div>
                  );
                }
                return null;
              })}
            </div>
          )}
        </main>

        {/* RIGHT — 步骤侧边栏 */}
        <StepsSidebar
          events={activeEvents}
          steps={activeSteps}
          selectedGateTitle={state.selectedGate?.title ?? null}
          onSelectGate={handleSelectGate}
          readOnly={isViewMode}
        />
      </div>
    </div>
  );
}
