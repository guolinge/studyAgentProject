import { describe, it, expect } from "vitest";
import { resolveAgentConfig, ConfigSchema, loadConfig } from "../src/config.js";

const raw = {
  defaults: { model: "claude-opus-4-8", effort: "high", maxTokens: 16000, thinking: "adaptive" },
  agents: {
    contentGeneration: { effort: "high", maxTokens: 32000 },
    contentReview: { model: "claude-haiku-4-5-20251001", effort: "low" },
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
    expect(resolveAgentConfig(cfg, "contentReview").model).toBe("claude-haiku-4-5-20251001");
  });

  it("rejects an unknown effort value", () => {
    expect(() =>
      ConfigSchema.parse({ ...raw, defaults: { ...raw.defaults, effort: "turbo" } }),
    ).toThrow();
  });
});

describe("loadConfig", () => {
  it("loads and validates the real agents.config.json from project root", () => {
    const cfg = loadConfig();
    expect(cfg.defaults.model).toBe("qwen-max-latest");
    expect(Object.keys(cfg.agents)).toContain("contentGeneration");
  });
});
