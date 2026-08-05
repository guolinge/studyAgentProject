/**
 * agentRunner.ts — 单次 agent 调用的最小封装
 *
 * 职责:把 AgentInput + ResolvedAgentConfig 映射成 messages.create 参数,
 * 调用注入的 ModelClient,把响应里所有 text 块拼成字符串返回。
 *
 * 设计原则:
 * - 不包含任何业务逻辑,只做参数映射 + 响应解析
 * - ModelClient 是接口而非 Anthropic SDK 实例,便于测试注入 fake
 * - cli.ts 用 sdk.messages.stream().finalMessage() 实现 ModelClient,
 *   这样即使 maxTokens 很大也不会被官方 SDK 拒绝(非流式请求有上限)
 */

import type { AgentInput, ResolvedAgentConfig } from "./types.js";

/**
 * 最小化 ModelClient 接口——只依赖我们需要的部分。
 * 响应里的 content 数组可能含 text 块和 thinking 块;
 * 我们只关心 text 块(thinking 块对 agent 是透明的推理过程)。
 */
export interface ModelClient {
  createMessage(params: Record<string, unknown>): Promise<{
    content: Array<{
      type: string;
      text?: string;
      // tool_use 块字段(runAgent 忽略,runAgentWithTools 使用)
      id?: string;
      name?: string;
      input?: unknown;
      // thinking 块字段(仅用于原样回放)
      thinking?: string;
    }>;
    stop_reason?: string | null;
  }>;
}

/**
 * 按配置把一次 agent 调用映射为 messages.create 参数,返回拼接后的文本输出。
 *
 * 参数映射说明:
 * - cfg.maxTokens  → max_tokens       (模型最多输出多少 token)
 * - cfg.effort     → output_config.effort  (推理深度;公司网关扩展字段)
 * - cfg.thinking   → thinking.type    ("adaptive" 时开启延伸思考;否则不传该字段)
 *
 * 返回值:把所有 type==="text" 的 content 块文本顺序拼接。
 * 通常只有一个 text 块,但有 thinking 时前面会有 thinking 块需要过滤掉。
 */
export async function runAgent(
  input: AgentInput,
  cfg: ResolvedAgentConfig,
  client: ModelClient,
): Promise<string> {
  const params: Record<string, unknown> = {
    model: cfg.model,
    max_tokens: cfg.maxTokens,
    system: input.system,
    output_config: { effort: cfg.effort }, // 公司网关推理深度控制
    messages: [{ role: "user", content: input.user }],
  };

  // thinking 字段只在需要延伸思考时传;不传该字段等价于 disabled
  if (cfg.thinking === "adaptive") {
    params.thinking = { type: "adaptive" };
  }

  const resp = await client.createMessage(params);

  // 过滤掉 thinking 块,只把 text 块拼起来作为 agent 的最终输出
  return resp.content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
}

/** 工具定义(Anthropic tools 参数的单项) */
export interface ToolDef {
  name: string;
  description: string;
  input_schema: object;
}

/** 工具执行器:按名字执行,返回给模型的文本结果 */
export type ToolExecutor = (name: string, input: unknown) => Promise<string>;

/**
 * 带工具的 agent 循环。
 *
 * 流程:
 *   1. 带 tools 调模型
 *   2. stop_reason==="tool_use" → 执行每个 tool_use,把结果作为 tool_result 回传,继续
 *   3. 否则 → 拼接 text 块返回
 *
 * 上限保护:最多 maxRounds 轮带工具的调用;到达上限后再做一次"不带 tools"的调用,
 * 强制模型给出文字结论,避免无限循环。
 *
 * thinking 回放:把模型返回的完整 content(含 thinking / tool_use 块)原样 push 回
 * messages,满足 adaptive thinking + tool use 的回放要求。
 */
export async function runAgentWithTools(
  input: AgentInput,
  cfg: ResolvedAgentConfig,
  client: ModelClient,
  tools: ToolDef[],
  execute: ToolExecutor,
  maxRounds = 6,
): Promise<string> {
  const messages: Array<{ role: string; content: unknown }> = [
    { role: "user", content: input.user },
  ];

  for (let round = 0; round <= maxRounds; round++) {
    const params: Record<string, unknown> = {
      model: cfg.model,
      max_tokens: cfg.maxTokens,
      system: input.system,
      output_config: { effort: cfg.effort },
      messages,
    };
    if (cfg.thinking === "adaptive") params.thinking = { type: "adaptive" };
    // 最后一轮不带 tools,强制文字结论
    if (round < maxRounds) params.tools = tools;

    const resp = await client.createMessage(params);
    const toolUses = resp.content.filter((b) => b.type === "tool_use");

    if (resp.stop_reason !== "tool_use" || toolUses.length === 0) {
      return resp.content
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string)
        .join("");
    }

    // 回放完整 assistant 内容(保留 thinking 块)
    messages.push({ role: "assistant", content: resp.content });

    const results = [];
    for (const tu of toolUses) {
      let out: string;
      try {
        out = await execute(tu.name as string, tu.input);
      } catch (e) {
        out = `工具执行失败：${(e as Error).message}`;
      }
      results.push({ type: "tool_result", tool_use_id: tu.id, content: out });
    }
    messages.push({ role: "user", content: results });
  }

  return "";
}
