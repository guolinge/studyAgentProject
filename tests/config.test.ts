import { describe, it, expect } from "vitest";
import { resolveAgentConfig, ConfigSchema } from "../src/config.js";

const raw = {
  defaults: { model: "claude-opus-4-8", effort: "high", maxTokens: 16000, thinking: "adaptive" },
  agents: {
    contentGeneration: { effort: "high", maxTokens: 32000 },
    contentReview: { model: "claude-haiku-4-5", effort: "low" },
  },
} as const;

describe("resolveAgentConfig", () => {
  it("merges override onto defaults", () => {
    const cfg = ConfigSchema.parse(raw);
    const gen = resolveAgentConfig(cfg, "contentGeneration");
    expect(gen).toEqual({
      model: "claude-opus-4-8",
      effort: "high",
      maxTokens: 32000, // 覆盖
      thinking: "adaptive",
    });
  });

  it("returns pure defaults when no override present", () => {
    const cfg = ConfigSchema.parse(raw);
    const q = resolveAgentConfig(cfg, "questionAnalysis");
    expect(q).toEqual(raw.defaults);
  });

  it("override model wins", () => {
    const cfg = ConfigSchema.parse(raw);
    expect(resolveAgentConfig(cfg, "contentReview").model).toBe("claude-haiku-4-5");
  });

  it("rejects an unknown effort value", () => {
    expect(() =>
      ConfigSchema.parse({ ...raw, defaults: { ...raw.defaults, effort: "turbo" } }),
    ).toThrow();
  });
});
