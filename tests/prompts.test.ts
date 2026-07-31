import { describe, it, expect } from "vitest";
import { loadPrompt } from "../src/prompts.js";

describe("loadPrompt", () => {
  it("loads style-rules content", () => {
    const text = loadPrompt("style-rules");
    expect(text).toContain("回答风格规则");
    expect(text.length).toBeGreaterThan(50);
  });

  it("loads content-generation content", () => {
    const text = loadPrompt("content-generation");
    expect(text).toContain("内容生成");
  });

  it("throws a clear error for a missing prompt", () => {
    expect(() => loadPrompt("does-not-exist")).toThrow(/prompt.*does-not-exist/i);
  });
});
