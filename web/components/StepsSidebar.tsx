"use client";

/**
 * StepsSidebar — 右侧步骤状态面板
 *
 * - step_start/progress/step_error → 不可点击，显示 ◌/✓/✗
 * - gate 条目 → 可点击，点击通知中间列切换显示
 *   - active gate（后面没有 gate_closed）有蓝色左边框
 *   - 被选中的有 indigo-50 背景
 * - gate_closed → 对应 gate 变灰
 * - 步骤统计（token + 耗时）在 readOnly 模式下（查看历史）显示
 */

import type { PipelineEvent } from "@/lib/types";
import type { StepStat } from "@/lib/types";

type StepStatus = "running" | "done";
interface Row {
  kind: "step";
  label: string;
  status: StepStatus;
}
interface ErrorRow {
  kind: "step_error";
  label: string;
  message: string;
}
interface GateRow {
  kind: "gate";
  title: string;
  content: string;
  closed: boolean;
}

type SidebarRow = Row | ErrorRow | GateRow;

function buildSidebarRows(events: PipelineEvent[]): SidebarRow[] {
  const rows: SidebarRow[] = [];

  for (const e of events) {
    if (e.type === "step_start") {
      rows.push({ kind: "step", label: e.label, status: "running" });
    } else if (e.type === "progress") {
      const idx = rows.findLastIndex((r): r is Row => r.kind === "step" && r.label === e.label && r.status === "running");
      if (idx >= 0) (rows[idx] as Row).status = "done";
      else rows.push({ kind: "step", label: e.label, status: "done" });
    } else if (e.type === "step_error") {
      rows.push({ kind: "step_error", label: e.label, message: e.message });
    } else if (e.type === "gate") {
      rows.push({ kind: "gate", title: e.title, content: e.content, closed: false });
    } else if (e.type === "gate_closed") {
      const last = [...rows].reverse().find((r): r is GateRow => r.kind === "gate" && !r.closed);
      if (last) last.closed = true;
    }
  }
  return rows;
}

interface Props {
  events: PipelineEvent[];
  steps?: StepStat[];
  stepTimings?: Record<string, number>; // label → durationMs，live 追踪
  selectedGateTitle: string | null;
  onSelectGate: (title: string, content: string) => void;
  readOnly?: boolean;
}

export default function StepsSidebar({
  events,
  steps,
  stepTimings,
  selectedGateTitle,
  onSelectGate,
  readOnly = false,
}: Props) {
  const rows = buildSidebarRows(events);

  // 找 active gate（最后一个未 closed 的 gate）
  const activeGate = [...rows].reverse().find((r): r is GateRow => r.kind === "gate" && !r.closed);

  if (rows.length === 0 && (!steps || steps.length === 0)) {
    return (
      <aside className="w-60 flex-shrink-0 border-l border-gray-200 bg-white flex items-center justify-center">
        <p className="text-xs text-gray-300">步骤将在运行时显示</p>
      </aside>
    );
  }

  return (
    <aside className="w-60 flex-shrink-0 flex flex-col border-l border-gray-200 bg-white overflow-hidden">
      <div className="px-3 pt-4 pb-2">
        <p className="text-[10px] tracking-widest uppercase text-gray-400">步骤</p>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-0.5">
        {rows.map((row, i) => {
          if (row.kind === "step") {
            const durationMs = row.status === "done"
              ? (steps?.find((s) => s.label === row.label)?.durationMs ?? stepTimings?.[row.label])
              : undefined;
            return (
              <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs text-gray-500">
                {row.status === "running" ? (
                  <span className="inline-block animate-spin text-indigo-400 flex-shrink-0">◌</span>
                ) : (
                  <span className="text-emerald-500 flex-shrink-0">✓</span>
                )}
                <span className="truncate flex-1">{row.label}</span>
                {durationMs != null && (
                  <span className="flex-shrink-0 text-gray-300 tabular-nums">
                    {(durationMs / 1000).toFixed(1)}s
                  </span>
                )}
              </div>
            );
          }
          if (row.kind === "step_error") {
            return (
              <div key={i} className="flex items-start gap-2 px-2.5 py-1.5 rounded-md text-xs">
                <span className="text-red-400 flex-shrink-0 mt-0.5">✗</span>
                <span className="text-gray-500 truncate" title={row.message}>{row.label}</span>
              </div>
            );
          }
          if (row.kind === "gate") {
            const isActive = activeGate?.title === row.title && !row.closed;
            const isSelected = selectedGateTitle === row.title;
            return (
              <button
                key={i}
                onClick={() => onSelectGate(row.title, row.content)}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs transition-colors text-left ${
                  row.closed
                    ? "text-gray-300"
                    : isSelected
                    ? "bg-indigo-50 text-indigo-600 border-l-2 border-indigo-400"
                    : isActive
                    ? "border-l-2 border-indigo-300 text-indigo-500 hover:bg-indigo-50"
                    : "text-gray-500 hover:bg-gray-50"
                }`}
              >
                <span className="flex-shrink-0">{row.closed ? "↵" : "⊙"}</span>
                <span className="truncate">{row.title}</span>
              </button>
            );
          }
          return null;
        })}

        {/* 步骤 token + 耗时统计（done 后或历史查看时显示） */}
        {steps && steps.length > 0 && (
          <div className="mt-4 pt-3 border-t border-gray-100">
            <p className="text-[10px] tracking-widest uppercase text-gray-400 px-2.5 mb-1.5">Token 用量</p>
            {steps.map((s, i) => (
              <div key={i} className="flex items-center gap-1 px-2.5 py-1 text-[10px] text-gray-400">
                <span className="truncate flex-1 min-w-0">{s.label}</span>
                <span className="flex-shrink-0 tabular-nums">
                  {(s.inputTokens + s.outputTokens).toLocaleString()}
                </span>
                {s.durationMs > 0 && (
                  <span className="flex-shrink-0 tabular-nums text-gray-300">
                    {(s.durationMs / 1000).toFixed(1)}s
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
