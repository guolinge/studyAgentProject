import { describe, it, expect, vi } from "vitest";
import {
  extractDiagramSpecs,
  renderDiagram,
  renderDiagrams,
  patchDiagrams,
} from "../src/diagrams.js";

const loadPrompt = (n: string) => n.toUpperCase();
const clean = '<svg viewBox="0 0 10 10"><rect fill="#eee"/></svg>';
const dirty = '<svg><rect class="x"/></svg>'; // 无 viewBox + class,lint 必挂

describe("extractDiagramSpecs", () => {
  it("extracts multiple specs (both colon styles)", () => {
    const md = "正文\n【配图指令:流程图 A→B】\n更多\n【配图指令：架构图】\n尾";
    const specs = extractDiagramSpecs(md);
    expect(specs).toHaveLength(2);
    expect(specs[0].instruction).toBe("流程图 A→B");
    expect(specs[1].instruction).toBe("架构图");
  });

  it("returns empty when there are none", () => {
    expect(extractDiagramSpecs("没有图")).toHaveLength(0);
  });
});

describe("renderDiagram", () => {
  it("retries with diagnostics, then returns a valid svg", async () => {
    const runRole = vi
      .fn()
      .mockResolvedValueOnce("```svg\n" + dirty + "\n```")
      .mockResolvedValueOnce(clean);
    const svg = await renderDiagram({ raw: "【配图指令:x】", instruction: "x" }, "ctx", {
      loadPrompt,
      runRole,
      mode: "svg",
    });
    expect(svg).toBe(clean);
    expect(runRole).toHaveBeenCalledTimes(2);
    expect(runRole.mock.calls[1][1].user).toMatch(/viewBox|class|校验/);
  });

  it("returns null after retries exhausted (degrade)", async () => {
    const runRole = vi.fn().mockResolvedValue(dirty);
    const svg = await renderDiagram({ raw: "【配图指令:x】", instruction: "x" }, "ctx", {
      loadPrompt,
      runRole,
      mode: "svg",
      maxRetries: 2,
    });
    expect(svg).toBeNull();
    expect(runRole).toHaveBeenCalledTimes(3); // 首次 + 2 次重试
  });
});

describe("renderDiagrams", () => {
  it("replaces successful placeholders with whiteboard, keeps failed ones", async () => {
    const md = "A\n【配图指令:好图】\nB\n【配图指令:坏图】\nC";
    const runRole = vi.fn(async (_role: string, input: { user: string }) =>
      input.user.includes("好图") ? clean : dirty,
    );
    const out = await renderDiagrams(md, { loadPrompt, runRole, mode: "svg", maxRetries: 1 });
    expect(out).toContain('<whiteboard type="svg">' + clean + "</whiteboard>");
    expect(out).toContain("【配图指令:坏图】"); // 失败的保留文字占位
    expect(out).not.toContain("【配图指令:好图】"); // 成功的被替换
  });
});

describe("patchDiagrams", () => {
  it("patches successful diagrams via updateDoc, skips failed ones", async () => {
    const md = "A\n【配图指令:好图】\nB\n【配图指令:坏图】\nC";
    const runRole = vi.fn(async (_role: string, input: { user: string }) =>
      input.user.includes("好图") ? clean : dirty,
    );
    const updateDoc = vi.fn().mockResolvedValue(undefined);
    const res = await patchDiagrams(md, "URL", { loadPrompt, runRole, mode: "svg", updateDoc, maxRetries: 1 });
    expect(res).toEqual({ total: 2, patched: 1 });
    expect(updateDoc).toHaveBeenCalledTimes(1);
    expect(updateDoc).toHaveBeenCalledWith(
      "URL",
      "【配图指令:好图】",
      '<whiteboard type="svg">' + clean + "</whiteboard>",
    );
  });
});

describe("renderDiagram ascii 模式", () => {
  it("提取纯 ascii 块并通过校验", async () => {
    const runRole = vi.fn().mockResolvedValue("```\n+--+\n```");
    const out = await renderDiagram(
      { raw: "【配图指令:x】", instruction: "x" }, "ctx",
      { loadPrompt, runRole, mode: "ascii" },
    );
    expect(out).toBe("+--+");
    expect(runRole.mock.calls[0][1].system).toMatch(/DIAGRAM-ASCII|DRAWING-RULES-ASCII/);
  });
});

describe("renderDiagrams ascii 包装", () => {
  it("替换为围栏代码块，不含 whiteboard", async () => {
    const runRole = vi.fn().mockResolvedValue("```\n+--+\n|甲|\n+--+\n```");
    const md = "前言\n【配图指令:示意】\n后语";
    const result = await renderDiagrams(md, { loadPrompt, runRole, mode: "ascii" });
    expect(result).toContain("```");
    expect(result).toContain("+--+");
    expect(result).not.toContain("whiteboard");
  });
});
