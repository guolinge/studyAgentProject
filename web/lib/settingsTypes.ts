export type ThemeValue = "indigo" | "violet" | "sky" | "emerald" | "rose";
export type EffortValue = "low" | "medium" | "high" | "xhigh" | "max";
export type ThinkingValue = "adaptive" | "disabled";

export interface AppSettings {
  anthropicApiKey:       string;
  anthropicBaseUrl:      string;
  feishuIndexDocToken:   string;
  feishuRootFolderToken: string;
  theme:                 ThemeValue;
  gate1Enabled:          boolean;
  maxReviewRetries:      number;
}

export interface AgentDefaults {
  model:     string;
  effort:    EffortValue;
  maxTokens: number;
  thinking:  ThinkingValue;
}

export interface AgentOverride {
  model?:     string;
  effort?:    EffortValue;
  maxTokens?: number;
  thinking?:  ThinkingValue;
}

export interface AgentConfig {
  defaults: AgentDefaults;
  agents:   Record<string, AgentOverride>;
}

export interface SettingsResponse {
  app:    AppSettings;   // anthropicApiKey is masked as ••••xxxx
  agents: AgentConfig;
}

export const AGENT_ROLE_LABELS: Record<string, string> = {
  questionAnalysis:    "问题分析",
  contentOrganization: "内容组织",
  contentGeneration:   "内容生成",
  contentReview:       "内容审核",
  diagramSvg:          "SVG 作图",
  incrementalMerge:    "增量合并",
  distiller:           "沉淀",
};

export const EFFORT_OPTIONS: EffortValue[] = ["low", "medium", "high", "xhigh", "max"];
export const THINKING_OPTIONS: ThinkingValue[] = ["adaptive", "disabled"];
export const THEME_OPTIONS: { value: ThemeValue; label: string; rgb: string }[] = [
  { value: "indigo",  label: "靛蓝", rgb: "99 102 241"  },
  { value: "violet",  label: "紫色", rgb: "139 92 246"  },
  { value: "sky",     label: "天蓝", rgb: "14 165 233"  },
  { value: "emerald", label: "翠绿", rgb: "16 185 129"  },
  { value: "rose",    label: "玫瑰", rgb: "244 63 94"   },
];
