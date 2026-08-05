import { describe, it, expect, vi } from "vitest";
import { runAgent, type ModelClient, runAgentWithTools, type ToolDef, type ToolExecutor } from "../src/agentRunner.js";
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

const TOOLS: ToolDef[] = [
  { name: "web_search", description: "搜索", input_schema: { type: "object", properties: {} } },
];

describe("runAgentWithTools", () => {
  it("executes tools then returns final text, echoing full assistant content back", async () => {
    const createMessage = vi.fn()
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [
          { type: "thinking", thinking: "想一下" },
          { type: "tool_use", id: "t1", name: "web_search", input: { query: "pnpm" } },
        ],
      })
      .mockResolvedValueOnce({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "研究备忘录：pnpm 用硬链接。" }],
      });

    const execute: ToolExecutor = vi.fn().mockResolvedValue("标题/摘要列表");
    const out = await runAgentWithTools(
      { system: "你是研究员", user: "研究 pnpm" }, cfg, { createMessage }, TOOLS, execute,
    );

    expect(out).toBe("研究备忘录：pnpm 用硬链接。");
    expect(execute).toHaveBeenCalledWith("web_search", { query: "pnpm" });
    expect(createMessage).toHaveBeenCalledTimes(2);

    // 第二次调用的 messages 里应回放了完整 assistant 内容 + tool_result
    const secondMessages = createMessage.mock.calls[1][0].messages;
    expect(secondMessages[1].role).toBe("assistant");
    expect(secondMessages[1].content).toEqual([
      { type: "thinking", thinking: "想一下" },
      { type: "tool_use", id: "t1", name: "web_search", input: { query: "pnpm" } },
    ]);
    expect(secondMessages[2].role).toBe("user");
    expect(secondMessages[2].content[0]).toEqual({
      type: "tool_result", tool_use_id: "t1", content: "标题/摘要列表",
    });
    // 第一次带 tools,以驱动工具调用
    expect(createMessage.mock.calls[0][0].tools).toBe(TOOLS);
  });

  it("returns text immediately when the model does not call a tool", async () => {
    const createMessage = vi.fn().mockResolvedValue({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "直接结论" }],
    });
    const out = await runAgentWithTools(
      { system: "s", user: "u" }, cfg, { createMessage }, TOOLS, vi.fn(),
    );
    expect(out).toBe("直接结论");
    expect(createMessage).toHaveBeenCalledOnce();
  });

  it("forces a final tool-free answer after maxRounds", async () => {
    // 一直返回 tool_use;到达上限时最后一次调用不应再带 tools
    const createMessage = vi.fn().mockImplementation((params: any) => {
      if (params.tools) {
        return Promise.resolve({
          stop_reason: "tool_use",
          content: [{ type: "tool_use", id: "t", name: "web_search", input: {} }],
        });
      }
      return Promise.resolve({ stop_reason: "end_turn", content: [{ type: "text", text: "兜底结论" }] });
    });
    const out = await runAgentWithTools(
      { system: "s", user: "u" }, cfg, { createMessage }, TOOLS, vi.fn().mockResolvedValue("r"), 2,
    );
    expect(out).toBe("兜底结论");
    // maxRounds=2 → 2 轮带 tools + 1 次不带 tools = 3 次
    expect(createMessage).toHaveBeenCalledTimes(3);
    expect(createMessage.mock.calls[2][0].tools).toBeUndefined();
  });

  it("feeds a readable error back as tool_result when executor throws", async () => {
    const createMessage = vi.fn()
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "t1", name: "read_page", input: { url: "x" } }],
      })
      .mockResolvedValueOnce({ stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] });
    const execute: ToolExecutor = vi.fn().mockRejectedValue(new Error("boom"));
    const out = await runAgentWithTools({ system: "s", user: "u" }, cfg, { createMessage }, TOOLS, execute);
    expect(out).toBe("ok");
    const secondMessages = createMessage.mock.calls[1][0].messages;
    expect(secondMessages[2].content[0].content).toContain("boom");
  });
});
