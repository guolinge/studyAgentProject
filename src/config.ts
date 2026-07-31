import { readFileSync } from "node:fs";
import { z } from "zod";
import type { AgentRole, ResolvedAgentConfig, AgentConfigOverride, AgentDefaults } from "./types.js";

const EffortSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);
const ThinkingSchema = z.enum(["adaptive", "disabled"]);

const DefaultsSchema = z.object({
  model: z.string().min(1),
  effort: EffortSchema,
  maxTokens: z.number().int().positive(),
  thinking: ThinkingSchema,
});

const OverrideSchema = z.object({
  model: z.string().min(1).optional(),
  effort: EffortSchema.optional(),
  maxTokens: z.number().int().positive().optional(),
  thinking: ThinkingSchema.optional(),
});

export const ConfigSchema = z.object({
  defaults: DefaultsSchema,
  agents: z.record(z.string(), OverrideSchema),
});

export type Config = z.infer<typeof ConfigSchema>;

/** defaults 合并某角色的覆盖项, 得到字段齐全的最终配置 */
export function resolveAgentConfig(cfg: Config, role: AgentRole): ResolvedAgentConfig {
  return { ...cfg.defaults, ...(cfg.agents[role] ?? {}) };
}

/** 从磁盘读取并校验配置文件 */
export function loadConfig(path = "agents.config.json"): Config {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return ConfigSchema.parse(raw);
}

// 编译期漂移守卫:若下面的 zod schema 与 types.ts 的手写类型不一致,这里会编译报错
type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _defaultsInSync: AssertEqual<z.infer<typeof DefaultsSchema>, AgentDefaults> = true;
const _overrideInSync: AssertEqual<z.infer<typeof OverrideSchema>, AgentConfigOverride> = true;
void _defaultsInSync;
void _overrideInSync;
