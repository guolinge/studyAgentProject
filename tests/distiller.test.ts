import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  parseDistillerOutput,
  applyChange,
  formatChangesForApproval,
  type ProposedChange,
} from "../src/distiller.js";

// ─── parseDistillerOutput ────────────────────────────────────────────────────

describe("parseDistillerOutput", () => {
  it("returns empty array for NO_CHANGES sentinel", () => {
    expect(parseDistillerOutput("<<<NO_CHANGES>>>")).toEqual([]);
    expect(parseDistillerOutput("  <<<NO_CHANGES>>>  \n")).toEqual([]);
  });

  it("parses a single change block", () => {
    const text = `<<<BEGIN_CHANGE>>>
FILE: prompts/style-rules.md
REASON: 用户希望代码示例必须包含注释
OLD:
代码示例需要有足够的注释
NEW:
代码示例必须包含行内注释,解释每步的「为什么」而不只是「做什么」。
<<<END_CHANGE>>>`;
    const result = parseDistillerOutput(text);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      file: "prompts/style-rules.md",
      reason: "用户希望代码示例必须包含注释",
      oldText: "代码示例需要有足够的注释",
      newText: "代码示例必须包含行内注释,解释每步的「为什么」而不只是「做什么」。",
    });
  });

  it("parses multiple change blocks", () => {
    const text = `<<<BEGIN_CHANGE>>>
FILE: prompts/style-rules.md
REASON: 第一条
OLD:
旧文1
NEW:
新文1
<<<END_CHANGE>>>
<<<BEGIN_CHANGE>>>
FILE: prompts/content-organization.md
REASON: 第二条
OLD:
旧文2
NEW:
新文2
<<<END_CHANGE>>>`;
    const result = parseDistillerOutput(text);
    expect(result).toHaveLength(2);
    expect(result[0].file).toBe("prompts/style-rules.md");
    expect(result[1].file).toBe("prompts/content-organization.md");
  });

  it("parses a change with empty OLD (append to file)", () => {
    const text = `<<<BEGIN_CHANGE>>>
FILE: prompts/style-rules.md
REASON: 追加新规则
OLD:

NEW:
新追加的规则内容
<<<END_CHANGE>>>`;
    const result = parseDistillerOutput(text);
    expect(result).toHaveLength(1);
    expect(result[0].oldText).toBe(""); // empty OLD
    expect(result[0].newText).toBe("新追加的规则内容");
  });

  it("returns empty array when output has no blocks and no NO_CHANGES", () => {
    // 模型输出乱七八糟时,安全降级返回空
    expect(parseDistillerOutput("模型输出了一些无关文字")).toEqual([]);
  });

  it("trims OLD and NEW section values", () => {
    const text = `<<<BEGIN_CHANGE>>>
FILE: prompts/style-rules.md
REASON: 测试
OLD:
  有首尾空白
NEW:
  结果也有空白
<<<END_CHANGE>>>`;
    const result = parseDistillerOutput(text);
    expect(result[0].oldText).toBe("有首尾空白");
    expect(result[0].newText).toBe("结果也有空白");
  });
});

// ─── applyChange ─────────────────────────────────────────────────────────────

describe("applyChange", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "distiller-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("replaces oldText with newText in the file", () => {
    const filePath = path.join(tmpDir, "prompts", "style-rules.md");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "前文\n旧规则内容\n后文\n", "utf8");

    applyChange(
      { file: "prompts/style-rules.md", reason: "r", oldText: "旧规则内容", newText: "新规则内容" },
      tmpDir,
    );

    const result = fs.readFileSync(filePath, "utf8");
    expect(result).toBe("前文\n新规则内容\n后文\n");
  });

  it("appends newText to end of file when oldText is empty", () => {
    const filePath = path.join(tmpDir, "prompts", "style-rules.md");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "现有内容\n", "utf8");

    applyChange(
      { file: "prompts/style-rules.md", reason: "r", oldText: "", newText: "追加内容" },
      tmpDir,
    );

    const result = fs.readFileSync(filePath, "utf8");
    expect(result).toBe("现有内容\n\n追加内容\n");
  });

  it("throws when oldText is not found in file", () => {
    const filePath = path.join(tmpDir, "prompts", "style-rules.md");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "现有内容\n", "utf8");

    expect(() =>
      applyChange(
        { file: "prompts/style-rules.md", reason: "r", oldText: "不存在的内容", newText: "X" },
        tmpDir,
      ),
    ).toThrow(/找不到要替换的原文/);
  });
});

// ─── formatChangesForApproval ─────────────────────────────────────────────────

describe("formatChangesForApproval", () => {
  it("formats changes as human-readable text", () => {
    const changes: ProposedChange[] = [
      {
        file: "prompts/style-rules.md",
        reason: "用户反馈代码注释不够详细",
        oldText: "代码需要注释",
        newText: "代码必须包含行内注释",
      },
    ];
    const text = formatChangesForApproval(changes);
    expect(text).toContain("prompts/style-rules.md");
    expect(text).toContain("用户反馈代码注释不够详细");
    expect(text).toContain("代码需要注释");
    expect(text).toContain("代码必须包含行内注释");
  });

  it("includes index numbers when multiple changes", () => {
    const changes: ProposedChange[] = [
      { file: "prompts/a.md", reason: "r1", oldText: "o1", newText: "n1" },
      { file: "prompts/b.md", reason: "r2", oldText: "o2", newText: "n2" },
    ];
    const text = formatChangesForApproval(changes);
    expect(text).toContain("1/2");
    expect(text).toContain("2/2");
  });

  it("shows append indicator when oldText is empty", () => {
    const changes: ProposedChange[] = [
      { file: "prompts/style-rules.md", reason: "r", oldText: "", newText: "新规则" },
    ];
    const text = formatChangesForApproval(changes);
    expect(text).toContain("追加");
  });
});
