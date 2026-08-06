"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { GateEvent } from "@/lib/types";
import { COPY_OUTLINE_SIGNAL } from "@/lib/types";
import { renderMarkdown } from "@/lib/markdown";

// 全屏弹窗（挂载到 body 避免层叠上下文问题）
function FullscreenModal({
  event,
  onClose,
  onSubmit,
  readOnly,
}: {
  event: GateEvent;
  onClose: () => void;
  onSubmit?: (reply: string) => void;
  readOnly: boolean;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [inputVal, setInputVal] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const submit = () => {
    const val = inputRef.current?.value.trim() ?? "";
    onSubmit?.(val);
    onClose();
  };
  const hasInput = inputVal.trim() !== "";

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      onClick={onClose}
    >
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* 弹窗主体 */}
      <div
        className="relative z-10 w-full max-w-3xl max-h-[90vh] flex flex-col bg-white rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center gap-2 px-6 py-3 bg-indigo-50 border-b border-indigo-100 flex-shrink-0">
          <span className="text-indigo-600 text-sm font-semibold">⊙ {event.title}</span>
          {readOnly && <span className="text-[10px] text-indigo-300 ml-1">只读</span>}
          <button
            onClick={onClose}
            className="ml-auto text-gray-400 hover:text-gray-600 transition-colors text-lg leading-none px-1"
            title="关闭 (Esc)"
          >
            ✕
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto px-6 py-5 text-gray-800 space-y-0.5 bg-white">
          {renderMarkdown(event.content)}
        </div>

        {/* 底部输入（非只读时显示） */}
        {!readOnly && (
          <div className="flex gap-3 px-6 py-4 bg-gray-50 border-t border-gray-100 flex-shrink-0">
            <textarea
              ref={inputRef}
              rows={2}
              placeholder="直接点击通过，或输入修改意见…"
              className="flex-1 bg-white border border-gray-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 rounded-lg text-sm text-gray-800 placeholder-gray-400 px-3 py-2 outline-none resize-none transition-all"
              onChange={(e) => setInputVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
              }}
            />
            <button
              onClick={submit}
              className={`px-5 py-2 rounded-lg text-white text-sm font-semibold whitespace-nowrap transition-colors shadow-sm self-end ${
                hasInput ? "bg-amber-500 hover:bg-amber-400" : "bg-indigo-600 hover:bg-indigo-500"
              }`}
            >
              {hasInput ? "提交意见 →" : "通过 ↵"}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

interface Props {
  event: GateEvent | null;
  onSubmit?: (reply: string) => void;
  readOnly?: boolean;
}

export default function GateViewer({ event, onSubmit, readOnly = false }: Props) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [inputVal, setInputVal] = useState("");
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!readOnly) inputRef.current?.focus();
  }, [event, readOnly]);

  if (!event) return null;

  const submit = () => {
    const val = inputRef.current?.value.trim() ?? "";
    onSubmit?.(val);
    if (inputRef.current) inputRef.current.value = "";
    setInputVal("");
  };

  const hasInput = inputVal.trim() !== "";

  return (
    <>
      <div className="w-full border border-indigo-200 rounded-xl overflow-hidden shadow-sm">
        {/* 头部 */}
        <div className="flex items-center gap-2 px-4 py-2 bg-indigo-50 border-b border-indigo-100">
          <span className="text-indigo-600 text-xs font-semibold">⊙ {event.title}</span>
          <div className="ml-auto flex items-center gap-2">
            {readOnly && <span className="text-[10px] text-indigo-300">只读</span>}
            <button
              onClick={() => setExpanded(true)}
              title="全屏查看"
              className="text-indigo-300 hover:text-indigo-500 transition-colors leading-none"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M3 4a1 1 0 011-1h4a1 1 0 010 2H5.414l3.293 3.293a1 1 0 01-1.414 1.414L4 6.414V8a1 1 0 01-2 0V4z" />
                <path d="M17 4a1 1 0 00-1-1h-4a1 1 0 000 2h2.586l-3.293 3.293a1 1 0 001.414 1.414L16 6.414V8a1 1 0 002 0V4z" />
                <path d="M3 16a1 1 0 001 1h4a1 1 0 000-2H5.414l3.293-3.293a1 1 0 00-1.414-1.414L4 13.586V12a1 1 0 00-2 0v4z" />
                <path d="M17 16a1 1 0 01-1 1h-4a1 1 0 010-2h2.586l-3.293-3.293a1 1 0 011.414-1.414L16 13.586V12a1 1 0 012 0v4z" />
              </svg>
            </button>
          </div>
        </div>

        {/* 内容区 */}
        <div className="px-4 py-4 min-h-48 max-h-[36rem] overflow-y-auto bg-white text-gray-800 space-y-0.5">
          {renderMarkdown(event.content)}
        </div>

        {/* 底部输入 */}
        {!readOnly && (
          <div className="flex gap-2 px-4 py-3 bg-gray-50 border-t border-gray-100">
            <textarea
              ref={inputRef}
              rows={3}
              placeholder="直接回车通过，或输入修改意见…"
              className="flex-1 bg-white border border-gray-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 rounded-lg text-sm text-gray-800 placeholder-gray-400 px-3 py-2 outline-none resize-none transition-all"
              onChange={(e) => setInputVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
              }}
            />
            {event.bundle && (
              <button
                type="button"
                onClick={async () => {
                  try { await navigator.clipboard.writeText(event.bundle!); }
                  catch { /* 剪贴板不可用时忽略，仍继续提交信号 */ }
                  onSubmit?.(COPY_OUTLINE_SIGNAL);
                }}
                className="px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap bg-emerald-600 hover:bg-emerald-500 text-white transition-colors shadow-sm"
              >
                复制大纲
              </button>
            )}
            <button
              onClick={submit}
              className={`px-4 py-2 rounded-lg text-white text-sm font-semibold whitespace-nowrap transition-colors shadow-sm ${
                hasInput ? "bg-amber-500 hover:bg-amber-400" : "bg-indigo-600 hover:bg-indigo-500"
              }`}
            >
              {hasInput ? "提交意见 →" : "通过 ↵"}
            </button>
          </div>
        )}
      </div>

      {expanded && (
        <FullscreenModal
          event={event}
          onClose={() => setExpanded(false)}
          onSubmit={readOnly ? undefined : (reply) => { onSubmit?.(reply); setExpanded(false); }}
          readOnly={readOnly}
        />
      )}
    </>
  );
}
