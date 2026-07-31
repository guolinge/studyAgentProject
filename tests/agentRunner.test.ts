import { describe, it, expect, vi } from "vitest";
import { runAgent, type ModelClient } from "../src/agentRunner.js";
import type { ResolvedAgentConfig } from "../src/types.js";

const cfg: ResolvedAgentConfig = {
  model: "claude-opus-4-8",
  effort: "high",
  maxTokens: 32000,
  thinking: "adaptive",
};

describe("runAgent", () => {
  it("maps config to API params and returns concatenated text", async () => {
    const createMessage = vi.fn().mockResolvedValue({
      content: [
        { type: "thinking", thinking: "..." },
        { type: "text", text: "第一段。" },
        { type: "text", text: "第二段。" },
      ],
    });
    const client: ModelClient = { createMessage };

    const out = await runAgent(
      { system: "你是助手", user: "讲讲 pnpm" },
      cfg,
      client,
    );

    expect(out).toBe("第一段。第二段。");
    expect(createMessage).toHaveBeenCalledOnce();
    const params = createMessage.mock.calls[0][0];
    expect(params.model).toBe("claude-opus-4-8");
    expect(params.max_tokens).toBe(32000);
    expect(params.system).toBe("你是助手");
    expect(params.thinking).toEqual({ type: "adaptive" });
    expect(params.output_config).toEqual({ effort: "high" });
    expect(params.messages).toEqual([{ role: "user", content: "讲讲 pnpm" }]);
  });

  it("omits thinking param when disabled", async () => {
    const createMessage = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "x" }] });
    await runAgent({ system: "s", user: "u" }, { ...cfg, thinking: "disabled" }, { createMessage });
    const params = createMessage.mock.calls[0][0];
    expect(params.thinking).toBeUndefined();
  });
});
