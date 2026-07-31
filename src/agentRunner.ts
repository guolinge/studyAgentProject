import type { AgentInput, ResolvedAgentConfig } from "./types.js";

// 只依赖我们需要的最小接口,便于测试注入 fake
export interface ModelClient {
  createMessage(params: Record<string, unknown>): Promise<{ content: Array<{ type: string; text?: string }> }>;
}

/** 按配置把一次 agent 调用映射为 messages.create 参数,返回拼接后的文本 */
export async function runAgent(
  input: AgentInput,
  cfg: ResolvedAgentConfig,
  client: ModelClient,
): Promise<string> {
  const params: Record<string, unknown> = {
    model: cfg.model,
    max_tokens: cfg.maxTokens,
    system: input.system,
    output_config: { effort: cfg.effort },
    messages: [{ role: "user", content: input.user }],
  };
  if (cfg.thinking === "adaptive") {
    params.thinking = { type: "adaptive" };
  }
  const resp = await client.createMessage(params);
  return resp.content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
}
