export interface StepStartEvent      { type: "step_start";      role: string; label: string }
export interface ProgressEvent       { type: "progress";        role: string; label: string } // 环节完成 ✓
export interface StepErrorEvent      { type: "step_error";      label: string; message: string; step?: string; recoverable?: boolean; soft?: boolean }
export interface GateEvent           { type: "gate";            title: string; content: string; bundle?: string }
export interface GateClosedEvent     { type: "gate_closed" }
export interface DocCreatedEvent     { type: "doc_created";     url: string; folderName: string }
export interface ReviewFeedbackEvent { type: "review_feedback"; content: string }
export interface StepDeltaEvent      { type: "step_delta";      role: string; label: string; delta: string }
export interface DoneEvent           { type: "done";            kind: "single" | "split" }
export interface ErrorEvent          { type: "error";           message: string }

export type PipelineEvent =
  | StepStartEvent
  | ProgressEvent
  | StepErrorEvent
  | StepDeltaEvent
  | GateEvent
  | GateClosedEvent
  | DocCreatedEvent
  | ReviewFeedbackEvent
  | DoneEvent
  | ErrorEvent;

export interface HistoryItem {
  id: string;
  topic: string;
  docTitle: string | null;
  docUrl: string | null;
  docFolder: string | null;
  status: "running" | "done" | "error";
  totalTokens: number;
  totalDurationMs: number;
  createdAt: number;
}

export interface StepStat {
  role: string;
  label: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  startedAt: number;
}

/** 门2「复制大纲」哨兵，与后端 orchestrator 保持一致 */
export const COPY_OUTLINE_SIGNAL = "__COPY_OUTLINE__";
