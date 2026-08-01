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
    content: Array<{ type: string; text?: string }>;
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
