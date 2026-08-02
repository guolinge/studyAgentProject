export interface ProgressEvent   { type: "progress"; role: string; label: string }
export interface GateEvent       { type: "gate";     title: string; content: string }
export interface GateClosedEvent { type: "gate_closed" }
export interface DoneEvent       { type: "done"; url: string; kind: "single" | "split" }
export interface ErrorEvent      { type: "error"; message: string }

export type PipelineEvent =
  | ProgressEvent
  | GateEvent
  | GateClosedEvent
  | DoneEvent
  | ErrorEvent;
