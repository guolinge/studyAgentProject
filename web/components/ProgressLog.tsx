"use client";

/**
 * ProgressLog — 流水线进度日志列表
 *
 * 事件类型与渲染对应：
 *   step_start      → 旋转环行（环节执行中）
 *   progress        → ✓ 行（环节完成），同时把对应的 step_start 行升级为完成态
 *   step_error      → ✗ 红色行
 *   gate            → 内联 GateCard（用户回复门）
 *   gate_closed     → 小提示行
 *   review_feedback → 橙色审核意见卡片
 *   done            → 绿色流水线完成标记（URL 在 page.tsx 的文档卡片里展示）
 *   error           → 红色错误卡片
 *
 * step state machine：
 *   从 events 数组推导 Map<label, "running"|"done">，同一 label 只渲染一行，
 *   step_start 置 running，progress 置 done。
 */

import { useEffect, useRef, useState } from "react";
import type { PipelineEvent } from "@/lib/types";

interface Props {
  events: PipelineEvent[];
  onGateSubmit: (reply: string) => void;
  runId: string | null;
}

// 渲染用的步骤条目（合并后的 step state）
type StepStatus = "running" | "done";
interface StepEntry { label: string; status: StepStatus }

// 渲染用的行类型，保留原始事件用于 gate / error / feedback 等需要内容的行
type RowItem =
  | { kind: "step"; label: string; status: StepStatus }
  | { kind: "step_error"; label: string; message: string }
  | { kind: "gate"; event: Extract<PipelineEvent, { type: "gate" }> }
  | { kind: "gate_closed" }
  | { kind: "review_feedback"; content: string }
  | { kind: "done" }
  | { kind: "error"; message: string };

/** 把 events 数组转为渲染用的行列表（step state machine） */
function buildRows(events: PipelineEvent[]): RowItem[] {
  const stepMap = new Map<string, StepStatus>(); // label → status
  const rows: RowItem[] = [];

  for (const e of events) {
    if (e.type === "step_start") {
      if (!stepMap.has(e.label)) {
        stepMap.set(e.label, "running");
        rows.push({ kind: "step", label: e.label, status: "running" });
      }
    } else if (e.type === "progress") {
      if (stepMap.has(e.label)) {
        // 升级已有行
        stepMap.set(e.label, "done");
        const row = rows.find((r) => r.kind === "step" && r.label === e.label) as
          | (RowItem & { kind: "step" })
          | undefined;
        if (row) row.status = "done";
      } else {
        // 兼容：只有 progress 没有 step_start 的情况
        stepMap.set(e.label, "done");
        rows.push({ kind: "step", label: e.label, status: "done" });
      }
    } else if (e.type === "step_error") {
      rows.push({ kind: "step_error", label: e.label, message: e.message });
    } else if (e.type === "gate") {
      rows.push({ kind: "gate", event: e });
    } else if (e.type === "gate_closed") {
      rows.push({ kind: "gate_closed" });
    } else if (e.type === "review_feedback") {
      rows.push({ kind: "review_feedback", content: e.content });
    } else if (e.type === "done") {
      rows.push({ kind: "done" });
    } else if (e.type === "error") {
      rows.push({ kind: "error", message: e.message });
    }
  }
  return rows;
}

export default function ProgressLog({ events, onGateSubmit, runId }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  if (events.length === 0) return null;

  const rows = buildRows(events);

  return (
    <div className="w-full space-y-1">
      <p className="text-[11px] tracking-widest uppercase text-gray-400 mb-3">运行日志</p>
      {rows.map((row, i) => (
        <RowRenderer key={i} row={row} onGateSubmit={onGateSubmit} runId={runId} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

function RowRenderer({
  row,
  onGateSubmit,
  runId,
}: {
  row: RowItem;
  onGateSubmit: (reply: string) => void;
  runId: string | null;
}) {
  if (row.kind === "step") {
    if (row.status === "running") {
      return (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md text-gray-500 text-sm">
          <span className="inline-block animate-spin text-indigo-400">◌</span>
          {row.label}
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-md text-gray-500 text-sm">
        <span className="text-emerald-500">✓</span>
        {row.label}
      </div>
    );
  }

  if (row.kind === "step_error") {
    return (
      <div className="flex items-start gap-2 px-3 py-2 rounded-md text-sm">
        <span className="text-red-500 mt-0.5">✗</span>
        <div>
          <span className="text-gray-600">{row.label}</span>
          <span className="text-red-500 ml-2 text-xs">{row.message}</span>
        </div>
      </div>
    );
  }

  if (row.kind === "gate") {
    return <GateCard event={row.event} onSubmit={onGateSubmit} runId={runId} />;
  }

  if (row.kind === "gate_closed") {
    return (
      <div className="flex items-center gap-2 px-3 py-1 text-xs text-gray-400">
        <span>↵</span> 已通过
      </div>
    );
  }

  if (row.kind === "review_feedback") {
    return (
      <div className="w-full border border-amber-200 rounded-xl bg-amber-50 p-4 my-2">
        <p className="text-xs text-amber-700 font-semibold mb-2">⚠ 审核意见（内容生成将重跑）</p>
        <pre className="text-sm text-amber-800 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto font-sans">
          {row.content}
        </pre>
      </div>
    );
  }

  if (row.kind === "done") {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-sm text-emerald-600 font-medium">
        <span>✅</span> 流水线完成
      </div>
    );
  }

  if (row.kind === "error") {
    return (
      <div className="w-full border border-red-200 rounded-xl bg-red-50 p-4 mt-2">
        <p className="text-xs text-red-600 font-semibold mb-1">❌ 出错</p>
        <p className="text-sm text-red-700">{row.message}</p>
      </div>
    );
  }

  return null;
}

function GateCard({
  event,
  onSubmit,
  runId,
}: {
  event: { title: string; content: string };
  onSubmit: (reply: string) => void;
  runId: string | null;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [inputVal, setInputVal] = useState(""); // 问题2：追踪输入内容

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = () => {
    const val = inputRef.current?.value.trim() ?? "";
    onSubmit(val);
    if (inputRef.current) inputRef.current.value = "";
    setInputVal("");
  };

  const hasInput = inputVal.trim() !== "";

  return (
    <div className="w-full border border-indigo-200 rounded-xl overflow-hidden my-2 shadow-sm">
      <div className="flex items-center gap-2 px-4 py-2 bg-indigo-50 border-b border-indigo-100">
        <span className="text-indigo-600 text-xs font-semibold">⊙ {event.title}</span>
      </div>
      <pre className="px-4 py-3 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto font-sans bg-white">
        {event.content}
      </pre>
      <div className="flex gap-2 px-4 py-3 bg-gray-50 border-t border-gray-100">
        <textarea
          ref={inputRef}
          rows={1}
          placeholder="直接回车通过，或输入修改意见…"
          className="flex-1 bg-white border border-gray-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 rounded-lg text-sm text-gray-800 placeholder-gray-400 px-3 py-2 outline-none resize-none transition-all"
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {/* 问题2：有输入内容时变橙色"提交意见"，空时蓝色"通过" */}
        <button
          onClick={submit}
          className={`px-4 py-2 rounded-lg text-white text-sm font-semibold whitespace-nowrap transition-colors shadow-sm ${
            hasInput
              ? "bg-amber-500 hover:bg-amber-400"
              : "bg-indigo-600 hover:bg-indigo-500"
          }`}
        >
          {hasInput ? "提交意见 →" : "通过 ↵"}
        </button>
      </div>
    </div>
  );
}
