import { describe, it, expect, vi } from "vitest";
import { runPipeline, extractTitle, type PipelineDeps } from "../src/orchestrator.js";

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

    const res = await runPipeline("讲讲 X", { loadPrompt, runRole, gate, publish });

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
    const res = await runPipeline("X", {
      loadPrompt,
      runRole,
      gate,
      publish: vi.fn().mockResolvedValue("u"),
    });

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
});
