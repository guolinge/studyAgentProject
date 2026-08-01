// agent 角色名(与 agents.config.json 的 key、prompts 文件名对应)
export type AgentRole =
  | "questionAnalysis"
  | "contentOrganization"
  | "contentGeneration"
  | "contentReview"
  | "diagramSvg"
  | "incrementalMerge"
  | "distiller";

// 配置文件里单个 agent 可覆盖的字段(全部可选)
export interface AgentConfigOverride {
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens?: number;
  thinking?: "adaptive" | "disabled";
}

// defaults 必须字段齐全
export interface AgentDefaults {
  model: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens: number;
  thinking: "adaptive" | "disabled";
}

// defaults 合并覆盖后的最终配置(字段齐全)
export type ResolvedAgentConfig = AgentDefaults;

// agent 运行入参
export interface AgentInput {
  system: string; // system prompt
  user: string; // 用户内容
}
