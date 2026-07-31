import { describe, it, expect, vi } from "vitest";
import { buildCreateDocArgs, larkCreateDoc } from "../src/tools/lark.js";

describe("buildCreateDocArgs", () => {
  it("builds docs +create argv with content flag", () => {
    const args = buildCreateDocArgs("<title>T</title><p>hi</p>");
    expect(args).toEqual(["docs", "+create", "--content", "<title>T</title><p>hi</p>", "--as", "user"]);
  });
});

describe("larkCreateDoc", () => {
  it("parses the doc URL out of lark-cli JSON stdout", async () => {
    const runner = vi.fn().mockResolvedValue(
      JSON.stringify({ ok: true, data: { document: { url: "https://futu.feishu.cn/docx/ABC123" } } }),
    );
    const url = await larkCreateDoc("<title>T</title>", runner);
    expect(url).toBe("https://futu.feishu.cn/docx/ABC123");
    expect(runner).toHaveBeenCalledWith("lark-cli", buildCreateDocArgs("<title>T</title>"));
  });

  it("throws when lark-cli reports failure", async () => {
    const runner = vi.fn().mockResolvedValue(JSON.stringify({ ok: false, error: { message: "boom" } }));
    await expect(larkCreateDoc("<title>T</title>", runner)).rejects.toThrow(/boom/);
  });
});
