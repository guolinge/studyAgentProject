export interface StepStartEvent      { type: "step_start";      role: string; label: string }
export interface ProgressEvent       { type: "progress";        role: string; label: string } // 环节完成 ✓
export interface StepErrorEvent      { type: "step_error";      label: string; message: string }
export interface GateEvent           { type: "gate";            title: string; content: string }
export interface GateClosedEvent     { type: "gate_closed" }
export interface DocCreatedEvent     { type: "doc_created";     url: string; folderName: string }
export interface ReviewFeedbackEvent { type: "review_feedback"; content: string }
export interface DoneEvent           { type: "done";            kind: "single" | "split" }
export interface ErrorEvent          { type: "error";           message: string }

export type PipelineEvent =
  | StepStartEvent
  | ProgressEvent
  | StepErrorEvent
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
