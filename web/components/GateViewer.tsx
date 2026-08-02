"use client";

/**
 * GateViewer — 中间列的门内容展示区
 *
 * - readOnly=false（active gate）：显示回复输入框，Enter 提交
 * - readOnly=true（历史查看 / 点击右栏过去的门）：仅展示内容
 * - event=null：返回 null（不渲染）
 */

import { useEffect, useRef, useState } from "react";
import type { GateEvent } from "@/lib/types";

interface Props {
  event: GateEvent | null;
  onSubmit?: (reply: string) => void;
  readOnly?: boolean;
}

export default function GateViewer({ event, onSubmit, readOnly = false }: Props) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [inputVal, setInputVal] = useState("");

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
    <div className="w-full border border-indigo-200 rounded-xl overflow-hidden shadow-sm">
      <div className="flex items-center gap-2 px-4 py-2 bg-indigo-50 border-b border-indigo-100">
        <span className="text-indigo-600 text-xs font-semibold">⊙ {event.title}</span>
        {readOnly && (
          <span className="ml-auto text-[10px] text-indigo-300">只读</span>
        )}
      </div>
      <pre className="px-4 py-3 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto font-sans bg-white">
        {event.content}
      </pre>
      {!readOnly && (
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
  );
}
