import { describe, it, expect, vi } from "vitest";
import { runSkeleton, markdownToDocXml, type SkeletonDeps } from "../src/orchestrator.js";

describe("markdownToDocXml", () => {
  it("wraps a title and keeps body as a paragraph", () => {
    const xml = markdownToDocXml("pnpm 原理", "正文一段");
    expect(xml).toContain("<title>pnpm 原理</title>");
    expect(xml).toContain("正文一段");
  });

  it("escapes XML-significant chars in the title", () => {
    const xml = markdownToDocXml("A & B < C", "x");
    expect(xml).toContain("<title>A &amp; B &lt; C</title>");
  });
});

describe("runSkeleton", () => {
  it("builds system from role prompt + style rules, generates, then publishes", async () => {
    const generate = vi.fn().mockResolvedValue("# pnpm 原理\n\n正文");
    const publish = vi.fn().mockResolvedValue("https://futu.feishu.cn/docx/XYZ");
    const deps: SkeletonDeps = {
      generate,
      publish,
      loadPrompt: (name) => (name === "content-generation" ? "ROLE" : "RULES"),
    };

    const result = await runSkeleton("pnpm 原理是什么", deps);

    expect(result.url).toBe("https://futu.feishu.cn/docx/XYZ");
    const sys = generate.mock.calls[0][0].system as string;
    expect(sys).toContain("ROLE");
    expect(sys).toContain("RULES");
    expect(generate.mock.calls[0][0].user).toBe("pnpm 原理是什么");
    expect(publish.mock.calls[0][0]).toContain("<title>");
  });
});
