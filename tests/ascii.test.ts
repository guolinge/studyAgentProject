import { describe, it, expect } from "vitest";
import { extractAsciiBlock, lintAscii } from "../src/tools/ascii.js";

describe("extractAsciiBlock", () => {
  it("提取裸围栏代码块内容", () => {
    const out = "说明\n```\n+--+\n|A |\n+--+\n```\n尾部";
    expect(extractAsciiBlock(out)).toBe("+--+\n|A |\n+--+");
  });

  it("提取带语言标注的围栏（```text）", () => {
    const out = "```text\n+--+\n```";
    expect(extractAsciiBlock(out)).toBe("+--+");
  });

  it("无代码块时抛错", () => {
    expect(() => extractAsciiBlock("没有围栏")).toThrow();
  });
});

describe("lintAscii", () => {
  const good = "+------+\n|  节点  |\n+------+";

  it("正常图通过", () => {
    expect(lintAscii(good).ok).toBe(true);
  });

  it("含禁用 Unicode 制表符 → 失败", () => {
    const r = lintAscii("┌────┐\n│ A  │\n└────┘");
    expect(r.ok).toBe(false);
    expect(r.issues.join()).toMatch(/Unicode|制表|禁用/);
  });

  it("行宽超 100 列 → 失败（中文按 2 列）", () => {
    const r = lintAscii("阿".repeat(51)); // 51*2 = 102 列
    expect(r.ok).toBe(false);
    expect(r.issues.join()).toMatch(/宽|列|100/);
  });

  it("中文 40 字 = 80 列，未超宽 → 通过", () => {
    expect(lintAscii("阿".repeat(40)).ok).toBe(true);
  });

  it("空内容 → 失败", () => {
    expect(lintAscii("   \n  ").ok).toBe(false);
  });
});
