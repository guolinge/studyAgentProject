import { describe, it, expect } from "vitest";
import { buildOutlineBundle, digestResearch } from "../src/outlineBundle.js";

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

const FULL_MEMO = `# 研究备忘录:pnpm
## 关键事实与结论
- pnpm 用硬链接省空间（来源：https://pnpm.io）
## 按话题的资料
### 硬链接
大段大段的网页正文摘录……这里很长很长……
### store
更多正文……
## 框定补充
- 建议补充话题：符号链接
## 存疑/待核实
- v9 是否默认启用 hoisting 未证实`;

describe("digestResearch", () => {
  it("只保留关键事实与结论 + 存疑/待核实，丢掉按话题的资料/框定补充", () => {
    const d = digestResearch(FULL_MEMO);
    expect(d).toContain("关键事实与结论");
    expect(d).toContain("硬链接省空间");
    expect(d).toContain("存疑/待核实");
    expect(d).toContain("未证实");
    expect(d).not.toContain("按话题的资料");
    expect(d).not.toContain("大段大段的网页正文");
    expect(d).not.toContain("框定补充");
  });
  it("空备忘录返回空串", () => {
    expect(digestResearch("")).toBe("");
  });
  it("抓不到目标小节时兜底截断（不超封顶）", () => {
    const noStruct = "x".repeat(5000);
    const d = digestResearch(noStruct);
    expect(d.length).toBeLessThan(5000);
  });
});

describe("buildOutlineBundle 研究三档", () => {
  const base = {
    question: "q", research: FULL_MEMO, skeleton: "骨架SK",
    generation: "GEN", styleRules: "STYLE", drawingRules: "DRAW",
  };
  it("full 档保留按话题的资料", () => {
    const b = buildOutlineBundle(base, "full");
    expect(b).toContain("大段大段的网页正文");
  });
  it("digest 档丢掉按话题的资料、保留关键事实", () => {
    const b = buildOutlineBundle(base, "digest");
    expect(b).toContain("硬链接省空间");
    expect(b).not.toContain("大段大段的网页正文");
  });
  it("none 档完全无研究段", () => {
    const b = buildOutlineBundle(base, "none");
    expect(b).not.toContain("联网研究资料");
    expect(b).not.toContain("硬链接省空间");
  });
  it("默认档为 digest", () => {
    const b = buildOutlineBundle(base);
    expect(b).not.toContain("大段大段的网页正文");
    expect(b).toContain("硬链接省空间");
  });
  it("framing 含自行联网搜索指令", () => {
    expect(buildOutlineBundle(base, "none")).toContain("自行联网搜索");
  });
});
