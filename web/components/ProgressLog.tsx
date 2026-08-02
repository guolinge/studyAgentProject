"use client";

/**
 * ProgressLog — 流水线进度日志列表
 *
 * 接受 events 数组，按事件类型渲染不同样式的行：
 *   progress    → 灰色步骤行（agent 已完成）
 *   gate        → 内联 GateCard（显示 agent 产出 + 输入框，等待用户回复）
 *   gate_closed → 小提示行（已通过）
 *   done        → 绿色完成卡片（含飞书文档 URL）
 *   error       → 红色错误卡片
 *
 * 每次 events 更新后自动滚动到底部，让用户始终看到最新进度。
 * onGateSubmit 由父组件传入，点击"通过"时调用，触发 POST /api/run/:id/gate。
 */

import { useEffect, useRef } from "react";
import type { PipelineEvent } from "@/lib/types";

interface Props {
  events: PipelineEvent[];
  onGateSubmit: (reply: string) => void;
  runId: string | null;
}

export default function ProgressLog({ events, onGateSubmit, runId }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  if (events.length === 0) return null;

  return (
    <div className="w-full space-y-1">
      <p className="text-[11px] tracking-widest uppercase text-gray-400 mb-3">运行日志</p>
      {events.map((e, i) => (
        <EventRow key={i} event={e} onGateSubmit={onGateSubmit} runId={runId} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

function EventRow({
  event,
  onGateSubmit,
  runId,
}: {
  event: PipelineEvent;
  onGateSubmit: (reply: string) => void;
  runId: string | null;
}) {
  if (event.type === "progress") {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-md text-gray-500 text-sm">
        <span className="text-emerald-500">✓</span>
        {event.label}
      </div>
    );
  }

  if (event.type === "gate") {
    return <GateCard event={event} onSubmit={onGateSubmit} runId={runId} />;
  }

  if (event.type === "gate_closed") {
    return (
      <div className="flex items-center gap-2 px-3 py-1 text-xs text-gray-400">
        <span>↵</span> 已通过
      </div>
    );
  }

  if (event.type === "done") {
    return (
      <div className="w-full border border-emerald-200 rounded-xl bg-emerald-50 p-4 mt-2">
        <p className="text-xs text-emerald-700 font-semibold mb-2">✅ 已写入飞书</p>
        <a
          href={event.url}
          target="_blank"
          rel="noreferrer"
          className="text-indigo-600 text-sm hover:underline break-all"
        >
          {event.url}
        </a>
      </div>
    );
  }

  if (event.type === "error") {
    return (
      <div className="w-full border border-red-200 rounded-xl bg-red-50 p-4 mt-2">
        <p className="text-xs text-red-600 font-semibold mb-1">❌ 出错</p>
        <p className="text-sm text-red-700">{event.message}</p>
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

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = () => {
    const val = inputRef.current?.value.trim() ?? "";
    onSubmit(val);
    if (inputRef.current) inputRef.current.value = "";
  };

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
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button
          onClick={submit}
          className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold whitespace-nowrap transition-colors shadow-sm"
        >
          通过 ↵
        </button>
      </div>
    </div>
  );
}
