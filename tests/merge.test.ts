import { describe, it, expect, vi } from "vitest";
import { parseMergeOutput, mergeIntoDoc } from "../src/merge.js";

describe("parseMergeOutput", () => {
  it("splits the anchor block id and the incremental markdown", () => {
    const out = "锚点: doxcnABC\n\n## 新增小节\n正文";
    expect(parseMergeOutput(out)).toEqual({
      anchorBlockId: "doxcnABC",
      incrementalMarkdown: "## 新增小节\n正文",
    });
  });

  it("throws when the 锚点 line is missing", () => {
    expect(() => parseMergeOutput("没有锚点行\n正文")).toThrow(/锚点/);
  });
});

describe("mergeIntoDoc", () => {
  it("fetches outline, generates increment, inserts after the parsed anchor", async () => {
    const fetchOutline = vi.fn().mockResolvedValue('<h2 id="doxcnX">章节</h2>');
    const runRole = vi.fn().mockResolvedValue("锚点: doxcnX\n\n增量正文");
    const insertAfter = vi.fn().mockResolvedValue(undefined);
    const loadPrompt = (n: string) => n.toUpperCase();
    const target = { title: "旧文", url: "URL", token: "t1" };

    const res = await mergeIntoDoc("新知识点", target, { loadPrompt, runRole, fetchOutline, insertAfter });

    expect(fetchOutline).toHaveBeenCalledWith("URL");
    // 增量 agent 收到旧文大纲(含 block_id)与新知识
    expect(runRole.mock.calls[0][1].user).toContain("doxcnX");
    expect(runRole.mock.calls[0][1].user).toContain("新知识点");
    // 按解析出的锚点把增量插进旧文
    expect(insertAfter).toHaveBeenCalledWith("URL", "doxcnX", "增量正文");
    expect(res.url).toBe("URL");
    expect(res.incrementalMarkdown).toBe("增量正文");
  });
});
