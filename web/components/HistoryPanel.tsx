"use client";

/**
 * HistoryPanel — 左侧历史记录面板
 *
 * - 「+ 新建对话」按钮 → 回到当前运行视图
 * - 搜索框（防抖 300ms）过滤历史条目
 * - 历史条目：topic 截断 2 行、日期、状态点
 * - 条目 draggable，拖到 textarea 时追加飞书引用文本
 * - 每条目右侧出现删除按钮（hover 时显示）
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { HistoryItem } from "@/lib/types";
import { getHistory, deleteRun } from "@/lib/api";

interface Props {
  activeRunId: string | null;
  viewRunId: string | null;
  onNewConversation: () => void;
  onSelectRun: (item: HistoryItem) => void;
  refreshTick: number; // 每次新 run 完成后外部递增，触发重新拉取
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return "昨天";
  if (diffDays < 7) return `${diffDays} 天前`;
  return d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function StatusDot({ status }: { status: HistoryItem["status"] }) {
  if (status === "running") return <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />;
  if (status === "error") return <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-400" />;
  return <span className="inline-block w-1.5 h-1.5 rounded-full bg-gray-300" />;
}

export default function HistoryPanel({
  activeRunId,
  viewRunId,
  onNewConversation,
  onSelectRun,
  refreshTick,
}: Props) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [hoverId, setHoverId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (q?: string) => {
    try {
      const list = await getHistory(q);
      setItems(list);
    } catch {
      // silently ignore fetch errors
    }
  }, []);

  // 初始加载 + refreshTick 变化时重拉
  useEffect(() => { load(); }, [load, refreshTick]);

  const handleQueryChange = (v: string) => {
    setQuery(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(v || undefined), 300);
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await deleteRun(id);
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const handleDragStart = (e: React.DragEvent, item: HistoryItem) => {
    e.dataTransfer.setData(
      "text/plain",
      JSON.stringify({ topic: item.docTitle ?? item.topic, docUrl: item.docUrl }),
    );
    e.dataTransfer.effectAllowed = "copy";
  };

  return (
    <aside className="w-60 flex-shrink-0 flex flex-col border-r border-gray-200 bg-white overflow-hidden">
      {/* 头部 */}
      <div className="px-3 pt-4 pb-2">
        <button
          onClick={onNewConversation}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 text-sm text-gray-600 hover:text-indigo-600 transition-colors"
        >
          <span className="text-base leading-none">＋</span>
          <span>新建对话</span>
        </button>
      </div>

      {/* 搜索 */}
      <div className="px-3 pb-2">
        <input
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder="搜索历史…"
          className="w-full text-xs bg-gray-50 border border-gray-200 focus:border-indigo-300 focus:ring-1 focus:ring-indigo-100 rounded-md px-2.5 py-1.5 outline-none placeholder-gray-400"
        />
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-0.5">
        {items.length === 0 && (
          <p className="text-xs text-gray-400 text-center mt-8">暂无历史记录</p>
        )}
        {items.map((item) => {
          const isActive = item.id === activeRunId;
          const isView = item.id === viewRunId;
          return (
            <div
              key={item.id}
              draggable
              onDragStart={(e) => handleDragStart(e, item)}
              onMouseEnter={() => setHoverId(item.id)}
              onMouseLeave={() => setHoverId(null)}
              onClick={() => onSelectRun(item)}
              className={`relative group flex items-start gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-colors select-none ${
                isView
                  ? "bg-indigo-50 border border-indigo-200"
                  : "hover:bg-gray-50"
              }`}
            >
              {/* 状态点 */}
              <div className="mt-1.5 flex-shrink-0">
                <StatusDot status={item.status} />
              </div>

              {/* 文本 */}
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-700 leading-snug line-clamp-2 break-words">
                  {item.docTitle ?? item.topic}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[10px] text-gray-400">{formatDate(item.createdAt)}</span>
                  {item.totalTokens > 0 && (
                    <span className="text-[10px] text-gray-300">{item.totalTokens.toLocaleString()} tok</span>
                  )}
                </div>
              </div>

              {/* 删除按钮 */}
              {hoverId === item.id && !isActive && (
                <button
                  onClick={(e) => handleDelete(e, item.id)}
                  className="flex-shrink-0 text-gray-300 hover:text-red-400 transition-colors text-xs px-1"
                  title="删除"
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
