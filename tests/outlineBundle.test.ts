import { describe, it, expect } from "vitest";
import { buildOutlineBundle } from "../src/outlineBundle.js";

const parts = {
  question: "讲讲 pnpm 的硬链接原理",
  research: "",
  skeleton: "# pnpm\n## 1. 问题\n### 1.1 幽灵依赖\n- 体量: 中, 约 200 字",
  generation: "【内容生成方法论正文】",
  styleRules: "【风格规则正文】",
  drawingRules: "【字符画图规范正文】",
};

describe("buildOutlineBundle", () => {
  it("按段序拼接，含所有必要段", () => {
    const b = buildOutlineBundle(parts);
    expect(b).toContain("资深技术作者");
    expect(b).toContain("讲讲 pnpm 的硬链接原理");
    expect(b).toContain("幽灵依赖");
    expect(b).toContain("【内容生成方法论正文】");
    expect(b).toContain("【风格规则正文】");
    expect(b).toContain("【字符画图规范正文】");
    const iGen = b.indexOf("【内容生成方法论正文】");
    const iOverride = b.indexOf("直接用字符图画进围栏代码块");
    const iStyle = b.indexOf("【风格规则正文】");
    expect(iGen).toBeLessThan(iOverride);
    expect(iOverride).toBeLessThan(iStyle);
  });

  it("research 为空时跳过研究段", () => {
    const b = buildOutlineBundle(parts);
    expect(b).not.toContain("联网研究资料");
  });

  it("research 非空时插入研究段，且在骨架之前", () => {
    const b = buildOutlineBundle({ ...parts, research: "【最新事实: pnpm v9】" });
    expect(b).toContain("联网研究资料");
    expect(b).toContain("【最新事实: pnpm v9】");
    expect(b.indexOf("【最新事实: pnpm v9】")).toBeLessThan(b.indexOf("幽灵依赖"));
  });
});
