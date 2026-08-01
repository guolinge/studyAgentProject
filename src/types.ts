/**
 * types.ts — 全局共享类型定义
 *
 * 这里只放纯类型(interface / type),不含任何运行时逻辑。
 * 所有模块从这里 import,避免循环依赖。
 */

/**
 * agent 角色名。
 * - 与 agents.config.json 的 key 一一对应(resolveAgentConfig 用它取配置)
 * - 与 prompts/ 下的文件名对应(loadPrompt("question-analysis") 等)
 * - cli.ts 的 ROLE_LABEL 映射把它转成中文展示
 */
export type AgentRole =
  | "questionAnalysis"     // 问题分析:framing 用户意图,输出一级话题 + 查重关键词
  | "contentOrganization"  // 内容组织:生成三级骨架(门2 前)
  | "contentGeneration"    // 内容生成:产出完整正文 Markdown(含【配图指令】占位)
  | "contentReview"        // 内容审核:对照骨架检查,PASS/FAIL
  | "diagramSvg"           // SVG 作图:把一条配图指令转成自包含 SVG
  | "incrementalMerge"     // 增量合并:读旧文大纲 + 新知识 → 产出{锚点 block_id, 增量 markdown}
  | "distiller";           // 蒸馏器:门反馈 → 规律提炼 → 提出 prompt 改动建议

/**
 * agents.config.json 中单个 agent 的可覆盖字段(全部可选)。
 * defaults 必须包含全部字段;agents.X 只需写要覆盖的字段,未写的从 defaults 继承。
 */
export interface AgentConfigOverride {
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens?: number;
  thinking?: "adaptive" | "disabled";
}

/**
 * defaults 对象的类型:所有字段必填。
 * 与 config.ts 里的 zod DefaultsSchema 保持同步(编译期守卫 _defaultsInSync 会验证)。
 */
export interface AgentDefaults {
  model: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens: number;
  thinking: "adaptive" | "disabled";
}

/**
 * defaults 合并某角色 override 后的最终配置——所有字段均有值。
 * resolveAgentConfig() 的返回类型,runAgent() 的输入类型。
 */
export type ResolvedAgentConfig = AgentDefaults;

/**
 * 单次 agent 调用的输入。
 * system 和 user 分别对应 messages.create 的 system 参数和 messages[0].content。
 */
export interface AgentInput {
  system: string; // 角色 prompt(通常从 prompts/*.md 读取,有时拼上 style-rules)
  user: string;   // 本次任务内容(含上游产出、搜索结果、修改意见等)
}

/**
 * 门反馈记录:用户在流水线某道确认门给出的非空修改意见。
 * 只记录非空 reply(空 reply=通过,无需记录)。
 * 用途:流水线结束后交给 Distiller,蒸馏成 prompt 规则写回文件。
 */
export interface GateFeedback {
  gate: string;     // 门标题,如"门1 · 确认范围/意图"、"门2 · 确认骨架"
  feedback: string; // 用户输入的修改意见(trim 后的原文)
}
