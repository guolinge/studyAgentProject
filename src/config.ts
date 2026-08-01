/**
 * config.ts — agents.config.json 的加载、校验与合并
 *
 * 配置结构:
 *   defaults: { model, effort, maxTokens, thinking }  ← 所有 agent 的基准
 *   agents:   { [role]: { ...override fields } }       ← 各角色的差量覆盖
 *
 * resolveAgentConfig(cfg, role) 把 defaults 和 agents[role] 合并,
 * 返回字段完整的 ResolvedAgentConfig,供 runAgent 直接使用。
 */

import { readFileSync } from "node:fs";
import { z } from "zod";
import type { AgentRole, ResolvedAgentConfig, AgentConfigOverride, AgentDefaults } from "./types.js";

// ── Zod 校验 schema ──────────────────────────────────────────────────────────

const EffortSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);
const ThinkingSchema = z.enum(["adaptive", "disabled"]);

/** defaults 对象:所有字段必填,无默认值 */
const DefaultsSchema = z.object({
  model: z.string().min(1),
  effort: EffortSchema,
  maxTokens: z.number().int().positive(),
  thinking: ThinkingSchema,
});

/** 单个 agent 的覆盖项:所有字段可选 */
const OverrideSchema = z.object({
  model: z.string().min(1).optional(),
  effort: EffortSchema.optional(),
  maxTokens: z.number().int().positive().optional(),
  thinking: ThinkingSchema.optional(),
});

/** 完整配置 schema;agents key 是字符串(对应 AgentRole),值是覆盖项 */
export const ConfigSchema = z.object({
  defaults: DefaultsSchema,
  agents: z.record(z.string(), OverrideSchema),
});

export type Config = z.infer<typeof ConfigSchema>;

// ── 运行时函数 ────────────────────────────────────────────────────────────────

/**
 * 把 defaults 和指定角色的 override 合并成完整配置。
 * 若该角色没有单独配置项,直接返回 defaults 的浅拷贝。
 * 扩展运算符确保 override 的字段优先于 defaults。
 */
export function resolveAgentConfig(cfg: Config, role: AgentRole): ResolvedAgentConfig {
  return { ...cfg.defaults, ...(cfg.agents[role] ?? {}) };
}

/**
 * 从磁盘读取 agents.config.json 并用 zod 校验。
 * 校验失败会抛出 ZodError(含具体字段路径),不静默。
 * path 默认相对 cwd,通常在项目根目录运行 npm start 时无需覆盖。
 */
export function loadConfig(path = "agents.config.json"): Config {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return ConfigSchema.parse(raw);
}

// ── 编译期漂移守卫 ────────────────────────────────────────────────────────────
//
// types.ts 的手写接口 和 config.ts 的 zod schema 各自独立维护,容易悄悄漂移。
// 这两行利用 TypeScript 结构类型的条件类型,在编译期检查两者是否完全一致。
// 若不一致,赋值给 true 会报类型错误,提前暴露问题。
//
type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _defaultsInSync: AssertEqual<z.infer<typeof DefaultsSchema>, AgentDefaults> = true;
const _overrideInSync: AssertEqual<z.infer<typeof OverrideSchema>, AgentConfigOverride> = true;
void _defaultsInSync;
void _overrideInSync;
