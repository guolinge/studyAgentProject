import { describe, it, expect, vi } from "vitest";
import {
  parseDedupKeywords,
  searchDuplicates,
  formatDedupPrompt,
  parseGateChoice,
} from "../src/dedup.js";

describe("parseDedupKeywords", () => {
  it("extracts keywords under the 查重关键词 section", () => {
    const qa = "## 意图\n搞懂 X\n\n## 一级话题\n- A\n- B\n\n## 查重关键词\n- pnpm\n- 硬链接\n- symlink";
    expect(parseDedupKeywords(qa)).toEqual(["pnpm", "硬链接", "symlink"]);
  });

  it("returns empty when the section is absent", () => {
    expect(parseDedupKeywords("## 意图\nx")).toEqual([]);
  });
});

describe("searchDuplicates", () => {
  it("searches each keyword and dedups candidates by token", async () => {
    const search = vi.fn(async (kw: string) => {
      if (kw === "pnpm") return [{ title: "pnpm原理", url: "u1", token: "t1" }];
      if (kw === "硬链接")
        return [
          { title: "pnpm原理", url: "u1", token: "t1" }, // 与 pnpm 命中同一篇
          { title: "链接", url: "u2", token: "t2" },
        ];
      return [];
    });
    const res = await searchDuplicates(["pnpm", "硬链接"], { search });
    expect(search).toHaveBeenCalledTimes(2);
    expect(res).toEqual([
      { title: "pnpm原理", url: "u1", token: "t1" },
      { title: "链接", url: "u2", token: "t2" },
    ]);
  });
});

const cands = [
  { title: "pnpm原理", url: "u1", token: "t1" },
  { title: "链接", url: "u2", token: "t2" },
];

describe("formatDedupPrompt", () => {
  it("lists candidates with 1-based index, title and url", () => {
    const s = formatDedupPrompt(cands);
    expect(s).toContain("1. pnpm原理");
    expect(s).toContain("2. 链接");
    expect(s).toContain("u1");
  });
});

describe("parseGateChoice", () => {
  it("number in range → merge that candidate", () => {
    expect(parseGateChoice("2", cands)).toEqual({ action: "merge", target: cands[1] });
  });
  it("empty → new", () => {
    expect(parseGateChoice("", cands)).toEqual({ action: "new" });
  });
  it("out of range → new", () => {
    expect(parseGateChoice("3", cands)).toEqual({ action: "new" });
  });
  it("non-number → new", () => {
    expect(parseGateChoice("看看第一个", cands)).toEqual({ action: "new" });
  });
});
