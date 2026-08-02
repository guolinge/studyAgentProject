"use client";

/**
 * StreamingCard — 实时流式输出卡片
 *
 * 在中间列展示当前正在运行的 agent 步骤的实时文本输出。
 * 文本随流增量追加，底部自动滚动，光标闪烁指示进行中。
 */

import { useEffect, useRef } from "react";

interface Props {
  label: string;
  text: string;
}

export default function StreamingCard({ label, text }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [text]);

  return (
    <div className="w-full border border-indigo-100 rounded-xl overflow-hidden shadow-sm">
      <div className="flex items-center gap-2 px-4 py-2 bg-indigo-50 border-b border-indigo-100">
        <span className="inline-block animate-spin text-indigo-400 text-xs">◌</span>
        <span className="text-indigo-600 text-xs font-medium">{label}</span>
        <span className="text-indigo-300 text-xs">正在输出…</span>
      </div>
      <div className="px-4 py-3 max-h-80 overflow-y-auto bg-white">
        <pre className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed font-sans">
          {text}
          {/* 光标闪烁 */}
          <span className="inline-block w-px h-[1em] bg-indigo-400 animate-pulse ml-px align-text-bottom" />
        </pre>
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
