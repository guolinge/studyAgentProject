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
