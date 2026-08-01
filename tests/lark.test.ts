import { describe, it, expect, vi } from "vitest";
import {
  buildCreateDocArgs,
  larkCreateDoc,
  buildUpdateStrReplaceArgs,
  larkUpdateStrReplace,
} from "../src/tools/lark.js";

describe("buildCreateDocArgs", () => {
  it("builds markdown +create argv reading content from stdin", () => {
    const args = buildCreateDocArgs("markdown");
    expect(args).toEqual(["docs", "+create", "--doc-format", "markdown", "--content", "-", "--as", "user"]);
  });

  it("supports xml format too", () => {
    const args = buildCreateDocArgs("xml");
    expect(args).toEqual(["docs", "+create", "--doc-format", "xml", "--content", "-", "--as", "user"]);
  });
});

describe("larkCreateDoc", () => {
  it("feeds content via stdin and parses the doc URL", async () => {
    const runner = vi.fn().mockResolvedValue(
      JSON.stringify({ ok: true, data: { document: { url: "https://futu.feishu.cn/docx/ABC123" } } }),
    );
    const md = "# 标题\n正文";
    const url = await larkCreateDoc(md, "markdown", runner);
    expect(url).toBe("https://futu.feishu.cn/docx/ABC123");
    // 第 3 个参数(stdin)收到原始 markdown
    expect(runner).toHaveBeenCalledWith("lark-cli", buildCreateDocArgs("markdown"), md);
  });

  it("throws when lark-cli reports failure", async () => {
    const runner = vi.fn().mockResolvedValue(JSON.stringify({ ok: false, error: { message: "boom" } }));
    await expect(larkCreateDoc("# T", "markdown", runner)).rejects.toThrow(/boom/);
  });

  it("throws a clear error when stdout is not JSON", async () => {
    const runner = vi.fn().mockResolvedValue("Error: lark-cli not authenticated");
    await expect(larkCreateDoc("# T", "markdown", runner)).rejects.toThrow(/非 JSON/);
  });
});

describe("buildUpdateStrReplaceArgs", () => {
  it("builds docs +update str_replace argv, content from stdin", () => {
    const args = buildUpdateStrReplaceArgs("https://x/docx/ABC", "【配图指令:图】");
    expect(args).toEqual([
      "docs",
      "+update",
      "--doc",
      "https://x/docx/ABC",
      "--command",
      "str_replace",
      "--pattern",
      "【配图指令:图】",
      "--content",
      "-",
      "--doc-format",
      "xml",
      "--as",
      "user",
    ]);
  });
});

describe("larkUpdateStrReplace", () => {
  it("feeds replacement via stdin and resolves on ok", async () => {
    const runner = vi.fn().mockResolvedValue(JSON.stringify({ ok: true, data: {} }));
    await larkUpdateStrReplace("URL", "PAT", "<whiteboard/>", runner);
    expect(runner).toHaveBeenCalledWith("lark-cli", buildUpdateStrReplaceArgs("URL", "PAT"), "<whiteboard/>");
  });

  it("throws when update reports failure", async () => {
    const runner = vi.fn().mockResolvedValue(JSON.stringify({ ok: false, error: { message: "bad" } }));
    await expect(larkUpdateStrReplace("URL", "PAT", "x", runner)).rejects.toThrow(/bad/);
  });
});
