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
  svgDiagram:            boolean;
  bundleResearch:        "full" | "digest" | "none";
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
  searchResearch:      "联网研究",
  contentOrganization: "内容组织",
  contentGeneration:   "内容生成",
  contentReview:       "内容审核",
  diagramSvg:          "作图",
  incrementalMerge:    "增量合并",
  distiller:           "沉淀",
};

export interface ModelPricing {
  inputPerM: string;   // e.g. "$3.00"
  outputPerM: string;  // e.g. "$15.00"
}

export interface ModelOption {
  id:       string;
  label:    string;
  provider: string;
  pricing?: ModelPricing;
}

export const MODEL_OPTIONS: ModelOption[] = [
  // Anthropic Claude (直接 SDK 调用)
  { id: "claude-opus-4-8",           label: "Opus 4.8",        provider: "Claude",  pricing: { inputPerM: "$5.00",  outputPerM: "$25.00" } },
  { id: "claude-sonnet-4-6",         label: "Sonnet 4.6",      provider: "Claude",  pricing: { inputPerM: "$3.00",  outputPerM: "$15.00" } },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5",       provider: "Claude",  pricing: { inputPerM: "$1.00",  outputPerM: "$5.00"  } },
  // AWS Claude (代理前缀)
  { id: "aws/claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet", provider: "AWS", pricing: { inputPerM: "$3.00",  outputPerM: "$15.00" } },
  { id: "aws/claude-3-5-haiku-20241022",  label: "Claude 3.5 Haiku",  provider: "AWS", pricing: { inputPerM: "$0.80",  outputPerM: "$4.00"  } },
  // Azure OpenAI
  { id: "azure/gpt-4o-jp",           label: "GPT-4o JP",       provider: "Azure",   pricing: { inputPerM: "$5.00",  outputPerM: "$15.00" } },
  // Google
  { id: "google/gemini-2.0-flash",   label: "Gemini 2.0 Flash", provider: "Google", pricing: { inputPerM: "$0.10",  outputPerM: "$0.40"  } },
  { id: "google/gemini-2.5-flash",   label: "Gemini 2.5 Flash", provider: "Google", pricing: { inputPerM: "$0.15",  outputPerM: "$0.60"  } },
  // Volcengine / DeepSeek
  { id: "volcengine/deepseek-r1",    label: "DeepSeek R1",     provider: "火山引擎", pricing: { inputPerM: "$0.55",  outputPerM: "$2.19"  } },
  { id: "volcengine/deepseek-v3",    label: "DeepSeek V3",     provider: "火山引擎", pricing: { inputPerM: "$0.27",  outputPerM: "$1.10"  } },
  // DashScope / Qwen
  { id: "dashscope/qwen-max-latest", label: "Qwen Max",        provider: "DashScope" },
  { id: "dashscope/qwen-plus-latest",label: "Qwen Plus",       provider: "DashScope" },
  // 私有部署
  { id: "private/deepseek-chat",     label: "DeepSeek Chat",   provider: "私有部署"  },
];

export const EFFORT_OPTIONS: EffortValue[] = ["low", "medium", "high", "xhigh", "max"];
export const THINKING_OPTIONS: ThinkingValue[] = ["adaptive", "disabled"];
export const THEME_OPTIONS: { value: ThemeValue; label: string; rgb: string }[] = [
  { value: "indigo",  label: "靛蓝", rgb: "99 102 241"  },
  { value: "violet",  label: "紫色", rgb: "139 92 246"  },
  { value: "sky",     label: "天蓝", rgb: "14 165 233"  },
  { value: "emerald", label: "翠绿", rgb: "16 185 129"  },
  { value: "rose",    label: "玫瑰", rgb: "244 63 94"   },
];
