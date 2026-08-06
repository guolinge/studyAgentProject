import { describe, it, expect, vi } from "vitest";
import { runPipeline, extractTitle, COPY_OUTLINE_SIGNAL, type PipelineDeps, type PipelineResult } from "../src/orchestrator.js";

/** 断言结果为 single 模式并返回，使后续属性访问类型安全 */
function asSingle(res: PipelineResult) {
  expect(res.kind).toBe("single");
  return res as Extract<PipelineResult, { kind: "single" }>;
}

describe("extractTitle", () => {
  it("takes the first markdown # heading", () => {
    expect(extractTitle("# pnpm 原理\n\n正文", "fb")).toBe("pnpm 原理");
  });
  it("falls back to the input when no heading", () => {
    expect(extractTitle("正文无标题", "回退")).toBe("回退");
  });
});

// 造一个按 role 返回桩值的 runRole(数组=按调用次序返回),并记录每次调用
function makeRunRole(map: Record<string, string | string[]>) {
  const calls: { role: string; input: { system: string; user: string } }[] = [];
  const counters: Record<string, number> = {};
  const runRole = vi.fn(async (role: string, input: { system: string; user: string }) => {
    calls.push({ role, input });
    const v = map[role];
    if (Array.isArray(v)) {
      const i = counters[role] ?? 0;
      counters[role] = i + 1;
      return v[Math.min(i, v.length - 1)];
    }
    return v ?? `<${role}>`;
  });
  return { runRole, calls };
}

// prompt 桩:名字大写即内容,便于断言 system 拼接
const loadPrompt = (name: string) => name.toUpperCase();

describe("runPipeline", () => {
  it("runs 4 stages in order, passes both gates, publishes the markdown", async () => {
    const { runRole, calls } = makeRunRole({
      questionAnalysis: "OUTLINE1",
      contentOrganization: "SKELETON",
      contentGeneration: "# T\n正文",
      contentReview: "PASS",
    });
    const gate = vi.fn().mockResolvedValue("");
    const publish = vi.fn().mockResolvedValue("https://futu.feishu.cn/docx/AAA");

    const res = asSingle(await runPipeline("讲讲 X", { loadPrompt, runRole, gate, publish }));

    expect(res.url).toBe("https://futu.feishu.cn/docx/AAA");
    expect(res.skeleton).toBe("SKELETON");
    expect(calls.map((c) => c.role).slice(0, 4)).toEqual([
      "questionAnalysis",
      "contentOrganization",
      "contentGeneration",
      "contentReview",
    ]);
    expect(gate).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls[0][0]).toBe("# T\n正文");
  });

  it("passes upstream output down into the next stage's input", async () => {
    const { runRole, calls } = makeRunRole({
      questionAnalysis: "OUTLINE1",
      contentOrganization: "SKELETON",
      contentGeneration: "MD",
      contentReview: "PASS",
    });
    const gate = vi.fn().mockResolvedValue("");
    await runPipeline("讲讲 X", { loadPrompt, runRole, gate, publish: vi.fn().mockResolvedValue("u") });

    const org = calls.find((c) => c.role === "contentOrganization")!;
    const gen = calls.find((c) => c.role === "contentGeneration")!;
    expect(org.input.user).toContain("OUTLINE1"); // 组织收到问题分析产出
    expect(gen.input.user).toContain("SKELETON"); // 生成收到骨架
  });

  it("gate feedback re-runs the upstream agent with the feedback", async () => {
    const { runRole, calls } = makeRunRole({
      questionAnalysis: ["OUTLINE_v1", "OUTLINE_v2"],
      contentOrganization: "SKELETON",
      contentGeneration: "MD",
      contentReview: "PASS",
    });
    const gate = vi
      .fn()
      .mockResolvedValueOnce("话题少了一个") // 门1 第一次:给反馈
      .mockResolvedValueOnce("") // 门1 第二次:通过
      .mockResolvedValueOnce(""); // 门2:通过
    await runPipeline("X", { loadPrompt, runRole, gate, publish: vi.fn().mockResolvedValue("u") });

    const qaCalls = calls.filter((c) => c.role === "questionAnalysis");
    expect(qaCalls.length).toBe(2); // 因反馈重跑
    expect(qaCalls[1].input.user).toContain("话题少了一个");
  });

  it("review FAIL triggers regeneration, then publishes the passing version", async () => {
    const { runRole, calls } = makeRunRole({
      questionAnalysis: "O",
      contentOrganization: "S",
      contentGeneration: ["MD_v1", "MD_v2"],
      contentReview: ["FAIL 第二节缺代码", "PASS"],
    });
    const gate = vi.fn().mockResolvedValue("");
    const res = asSingle(await runPipeline("X", {
      loadPrompt,
      runRole,
      gate,
      publish: vi.fn().mockResolvedValue("u"),
    }));

    const genCalls = calls.filter((c) => c.role === "contentGeneration");
    expect(genCalls.length).toBe(2); // 打回重生成一次
    expect(res.markdown).toBe("MD_v2");
    expect(genCalls[1].input.user).toContain("第二节缺代码");
  });

  it("appends style-rules to organization & generation system prompts", async () => {
    const { runRole, calls } = makeRunRole({
      questionAnalysis: "O",
      contentOrganization: "S",
      contentGeneration: "MD",
      contentReview: "PASS",
    });
    await runPipeline("X", {
      loadPrompt,
      runRole,
      gate: vi.fn().mockResolvedValue(""),
      publish: vi.fn().mockResolvedValue("u"),
    });

    const org = calls.find((c) => c.role === "contentOrganization")!;
    const gen = calls.find((c) => c.role === "contentGeneration")!;
    expect(org.input.system).toContain("CONTENT-ORGANIZATION");
    expect(org.input.system).toContain("STYLE-RULES");
    expect(gen.input.system).toContain("STYLE-RULES");
  });

  it("runs searchResearch and injects its memo into organization & generation", async () => {
    const { runRole, calls } = makeRunRole({
      questionAnalysis:    "## 意图\nX\n## 一级话题\n- a",
      searchResearch:      "研究备忘录：MEMO",
      contentOrganization: "骨架",
      contentGeneration:   "正文",
      contentReview:       "PASS",
    });
    const gate = vi.fn().mockResolvedValue("");
    const publish = vi.fn().mockResolvedValue("http://doc");
    await runPipeline("讲讲 X", {
      loadPrompt, runRole, gate, publish, researchEnabled: true,
    });

    // searchResearch 被调用一次
    const researchCalls = calls.filter((c) => c.role === "searchResearch");
    expect(researchCalls).toHaveLength(1);
    // 备忘录注入到内容组织与内容生成的 user
    const orgCall = calls.find((c) => c.role === "contentOrganization");
    const genCall = calls.find((c) => c.role === "contentGeneration");
    expect(orgCall!.input.user).toContain("研究备忘录：MEMO");
    expect(genCall!.input.user).toContain("研究备忘录：MEMO");
  });

  it("dedup: merge choice returns the merged doc and skips the new-doc pipeline", async () => {
    const { runRole, calls } = makeRunRole({
      questionAnalysis: "意图\n## 查重关键词\n- pnpm",
      contentOrganization: "S",
      contentGeneration: "MD",
      contentReview: "PASS",
    });
    const search = vi.fn().mockResolvedValue([{ title: "旧文", url: "U", token: "t1" }]);
    const merge = vi.fn().mockResolvedValue({ url: "U", incrementalMarkdown: "增量" });
    const gate = vi
      .fn()
      .mockResolvedValueOnce("") // 门1 通过
      .mockResolvedValueOnce("1"); // 查重门:选合并第 1 篇
    const publish = vi.fn().mockResolvedValue("newurl");

    const res = asSingle(await runPipeline("讲讲 pnpm", { loadPrompt, runRole, gate, publish, dedup: { search, merge } }));

    expect(merge).toHaveBeenCalledTimes(1);
    expect(res.url).toBe("U");
    expect(publish).not.toHaveBeenCalled(); // 合并路径不新建
    expect(calls.find((c) => c.role === "contentOrganization")).toBeUndefined(); // 提前返回,没走组织
  });

  it("dedup: new choice continues building a new doc", async () => {
    const { runRole } = makeRunRole({
      questionAnalysis: "意图\n## 查重关键词\n- pnpm",
      contentOrganization: "S",
      contentGeneration: "MD",
      contentReview: "PASS",
    });
    const search = vi.fn().mockResolvedValue([{ title: "旧文", url: "U", token: "t1" }]);
    const merge = vi.fn();
    const gate = vi
      .fn()
      .mockResolvedValueOnce("") // 门1
      .mockResolvedValueOnce("") // 查重门:回车=新建
      .mockResolvedValueOnce(""); // 门2
    const publish = vi.fn().mockResolvedValue("newurl");

    const res = asSingle(await runPipeline("讲讲 pnpm", { loadPrompt, runRole, gate, publish, dedup: { search, merge } }));

    expect(merge).not.toHaveBeenCalled();
    expect(res.url).toBe("newurl"); // 走了新建
  });

  it("feedbacks is empty when all gates pass on first try", async () => {
    const { runRole } = makeRunRole({
      questionAnalysis: "O",
      contentOrganization: "S",
      contentGeneration: "MD",
      contentReview: "PASS",
    });
    const res = asSingle(await runPipeline("X", {
      loadPrompt,
      runRole,
      gate: vi.fn().mockResolvedValue(""),
      publish: vi.fn().mockResolvedValue("u"),
    }));
    expect(res.feedbacks).toEqual([]);
  });

  it("feedbacks captures gate title and text when user gives feedback", async () => {
    const { runRole } = makeRunRole({
      questionAnalysis: ["O_v1", "O_v2"],
      contentOrganization: ["S_v1", "S_v2"],
      contentGeneration: "MD",
      contentReview: "PASS",
    });
    const gate = vi
      .fn()
      .mockResolvedValueOnce("话题太少了") // 门1 反馈
      .mockResolvedValueOnce("") // 门1 通过
      .mockResolvedValueOnce("要加一节复杂度分析") // 门2 反馈
      .mockResolvedValueOnce(""); // 门2 通过
    const res = asSingle(await runPipeline("X", {
      loadPrompt,
      runRole,
      gate,
      publish: vi.fn().mockResolvedValue("u"),
    }));
    expect(res.feedbacks).toHaveLength(2);
    expect(res.feedbacks[0]).toEqual({ gate: "门1 · 确认范围/意图", feedback: "话题太少了" });
    expect(res.feedbacks[1]).toEqual({ gate: "门2 · 确认骨架", feedback: "要加一节复杂度分析" });
  });

  it("degrades gracefully when searchResearch throws (still publishes)", async () => {
    const runRole = vi.fn(async (role: string) => {
      if (role === "searchResearch") throw new Error("网关不支持工具");
      if (role === "questionAnalysis") return "## 意图\nX\n## 一级话题\n- a";
      if (role === "contentReview") return "PASS";
      return "stub";
    });
    const gate = vi.fn().mockResolvedValue("");
    const publish = vi.fn().mockResolvedValue("http://doc");
    const res = await runPipeline("讲讲 X", {
      loadPrompt, runRole, gate, publish, researchEnabled: true,
    });
    expect(publish).toHaveBeenCalledOnce(); // 研究失败仍然出稿
    expect((res as { kind: string }).kind).toBe("single");
  });
});

describe("门2 复制大纲 offload 分支", () => {
  it("门2 返回哨兵 → 建空文档+入索引+结束，不跑生成/审核", async () => {
    const loadPrompt = (n: string) => `[${n}]`;
    const runRole = vi.fn(async (role: string) => {
      if (role === "questionAnalysis") return "## 文档标题\npnpm 原理\n## 归档位置\n技术\n";
      if (role === "contentOrganization") return "# pnpm\n## 1. 问题\n### 1.1\n- 体量: 中, 约 200 字";
      return "SHOULD_NOT_BE_CALLED:" + role;
    });
    const gate = vi.fn()
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce(COPY_OUTLINE_SIGNAL);
    const publishBlank = vi.fn().mockResolvedValue("http://blank-doc");
    const updateIndex = vi.fn().mockResolvedValue(undefined);

    const res = await runPipeline("讲讲 pnpm", {
      loadPrompt, runRole, gate,
      publish: vi.fn().mockResolvedValue("u"),
      publishBlank, updateIndex,
    });

    expect(res.kind).toBe("outline_copied");
    if (res.kind === "outline_copied") {
      expect(res.url).toBe("http://blank-doc");
      expect(res.bundle).toContain("pnpm");
      expect(res.bundle).toContain("资深技术作者");
    }
    expect(publishBlank).toHaveBeenCalledTimes(1);
    expect(updateIndex).toHaveBeenCalledTimes(1);
    expect(runRole).not.toHaveBeenCalledWith("contentGeneration", expect.anything());
    expect(runRole).not.toHaveBeenCalledWith("contentReview", expect.anything());
  });
});
