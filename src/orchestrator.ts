import type { AgentInput, AgentRole } from "./types.js";
import type { Asker } from "./io.js";

/** 从生成的 Markdown 里取首个 # 标题作为文档标题(取不到就用输入回退) */
export function extractTitle(markdown: string, fallback: string): string {
  const m = markdown.match(/^#\s+(.+)$/m);
  return (m?.[1] ?? fallback).trim();
}

export interface PipelineDeps {
  loadPrompt: (name: string) => string;
  runRole: (role: AgentRole, input: AgentInput) => Promise<string>;
  gate: Asker; // 两道门共用
  publish: (markdown: string) => Promise<string>;
  reviewMaxRetries?: number; // 审核打回上限,默认 2
  search?: (query: string) => Promise<string>; // 联网搜索,返回已格式化的上下文;不传则跳过
}

export interface PipelineResult {
  url: string;
  markdown: string;
  skeleton: string;
}

/** 拼 system:角色 prompt(+ 可选附上 style-rules) */
function buildSystem(loadPrompt: PipelineDeps["loadPrompt"], roleFile: string, withRules: boolean): string {
  const role = loadPrompt(roleFile);
  if (!withRules) return role;
  return `${role}\n\n---\n\n${loadPrompt("style-rules")}`;
}

/**
 * 门迭代:跑 role 产出 → 展示给使用者 → 拿反馈。
 * 空反馈=通过,返回产出;非空=把反馈拼进 user 重跑,循环到通过。
 */
async function iterateWithGate(
  deps: PipelineDeps,
  role: AgentRole,
  gateTitle: string,
  system: string,
  baseUser: string,
): Promise<string> {
  let output = await deps.runRole(role, { system, user: baseUser });
  for (;;) {
    const reply = await deps.gate(gateTitle, output);
    if (reply === "") return output;
    const user = `${baseUser}\n\n【上一版产出】\n${output}\n\n【使用者修改意见】\n${reply}\n\n请据此修改后重新输出(保持同样的格式)。`;
    output = await deps.runRole(role, { system, user });
  }
}

/**
 * 完整流水线:问题分析 →门1→ 内容组织 →门2→ 内容生成 →审核打回→ 写飞书。
 * 上游产出顺流水线下传;两道门"展示+文字反馈迭代";审核 FAIL 打回重生成(有上限)。
 */
export async function runPipeline(userInput: string, deps: PipelineDeps): Promise<PipelineResult> {
  const maxRetries = deps.reviewMaxRetries ?? 2;

  // ① 问题分析 →门1(轻):确认范围/意图
  const qaSystem = buildSystem(deps.loadPrompt, "question-analysis", false);
  const outline1 = await iterateWithGate(deps, "questionAnalysis", "门1 · 确认范围/意图", qaSystem, userInput);

  // 联网搜索:搜一次(用用户输入作 query),结果顺流水线下传;失败则优雅降级
  let searchContext = "";
  if (deps.search) {
    try {
      searchContext = await deps.search(userInput);
    } catch (e) {
      console.error(`  ⚠ 联网搜索失败,降级为纯模型作答:${(e as Error).message}`);
      searchContext = "";
    }
  }
  const withSearch = (base: string) => (searchContext ? `${base}\n\n${searchContext}` : base);

  // ② 内容组织 →门2(重):确认三级骨架(输入含问题分析产出 + 搜索结果)
  const orgSystem = buildSystem(deps.loadPrompt, "content-organization", true);
  const orgUser = withSearch(`${userInput}\n\n【已确认的范围与意图】\n${outline1}`);
  const skeleton = await iterateWithGate(deps, "contentOrganization", "门2 · 确认骨架", orgSystem, orgUser);

  // ③ 内容生成(输入含骨架 + 搜索结果)
  const genSystem = buildSystem(deps.loadPrompt, "content-generation", true);
  const genUser = withSearch(`${userInput}\n\n【已确认的骨架】\n${skeleton}`);
  let markdown = await deps.runRole("contentGeneration", { system: genSystem, user: genUser });

  // ④ 内容审核:对照骨架检查;FAIL 打回③重生成,最多 maxRetries 次
  const reviewSystem = buildSystem(deps.loadPrompt, "content-review", false);
  for (let i = 0; i < maxRetries; i++) {
    const verdict = await deps.runRole("contentReview", {
      system: reviewSystem,
      user: `【骨架】\n${skeleton}\n\n【正文】\n${markdown}`,
    });
    if (/^\s*PASS/.test(verdict)) break;
    markdown = await deps.runRole("contentGeneration", {
      system: genSystem,
      user: `${genUser}\n\n【上一版正文】\n${markdown}\n\n【审核问题】\n${verdict}\n\n请修补后重新输出完整正文。`,
    });
  }

  const url = await deps.publish(markdown);
  return { url, markdown, skeleton };
}
