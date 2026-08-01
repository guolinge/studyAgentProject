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
    expect(text).toContain("搜索结果");
    expect(text).toContain("来源");
  });

  it("throws a clear error for a missing prompt", () => {
    expect(() => loadPrompt("does-not-exist")).toThrow(/prompt.*does-not-exist/i);
  });

  it("loads question-analysis content", () => {
    const text = loadPrompt("question-analysis");
    expect(text).toContain("问题分析");
    expect(text).toContain("一级");
  });

  it("loads content-organization content", () => {
    const text = loadPrompt("content-organization");
    expect(text).toContain("内容组织");
    expect(text).toContain("表达形式");
  });

  it("loads content-review content", () => {
    const text = loadPrompt("content-review");
    expect(text).toContain("检查清单");
    expect(text).toMatch(/PASS/);
  });

  it("loads drawing-rules content", () => {
    const text = loadPrompt("drawing-rules");
    expect(text).toContain("viewBox");
    expect(text).toContain("自包含");
  });

  it("loads diagram-svg content", () => {
    const text = loadPrompt("diagram-svg");
    expect(text).toContain("SVG");
    expect(text).toContain("配图指令");
  });
});
