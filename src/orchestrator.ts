/**
 * orchestrator.ts — 流水线编排核心
 *
 * 完整流程:
 *   问题分析 →门1→ [查重分流] → 联网搜索 → 内容组织 →门2→ 内容生成 →审核→ publish
 *
 * 查重分流(有 dedup 依赖时):
 *   - 提取查重关键词 → 搜索相关旧文档
 *   - 有候选 → 弹查重门 → 选合并 → mergeIntoDoc → 提前返回(不走新建流程)
 *   - 选新建 / 无候选 → 继续正常流程
 *
 * 门机制(iterateWithGate):
 *   - 用户回车 = 通过,返回当前产出
 *   - 用户输入意见 = 把意见拼进 user prompt 重跑,循环直到通过
 *   - 每次非空反馈通过 collector 回调收集,最终在 PipelineResult.feedbacks 里返回
 *
 * 所有依赖通过 PipelineDeps 注入,单测时可替换所有副作用。
 */

import type { AgentInput, AgentRole, GateFeedback } from "./types.js";
import type { Asker } from "./io.js";
import type { SearchHit } from "./tools/lark.js";
import { parseDedupKeywords, searchDuplicates, formatDedupPrompt, parseGateChoice } from "./dedup.js";
import { renderFolderTree, findByToken, folderTreeRoot } from "./folderTree.js";

/** 归档位置：现有文件夹 or 需要新建的文件夹 */
export type PlacementInfo =
  | { type: "existing"; folderToken: string; title: string }
  | { type: "new"; parentToken: string; folderName: string; title: string };

/**
 * 从 questionAnalysis 输出中解析 ## 文档标题 和 ## 归档位置。
 *
 * 现有文件夹格式：`<路径> [token: <token>]`
 * 新建文件夹格式：`新建文件夹：<父路径>/<新名> [parent_token: <token>]`
 *
 * token 合法性用 findByToken 验证；无法识别时 fallback 到技术知识库根节点。
 */
export function parsePlacement(output: string, userInputFallback: string): PlacementInfo {
  const titleMatch = output.match(/^##\s*文档标题\s*\n([^\n#]+)/m);
  const title = titleMatch ? titleMatch[1].trim() : userInputFallback;

  const locMatch = output.match(/^##\s*归档位置\s*\n([^\n#]+)/m);
  const locLine = locMatch ? locMatch[1].trim() : "";

  // 新建文件夹
  const newMatch = locLine.match(/新建文件夹[：:].+?\[parent_token:\s*([A-Za-z0-9]+)\]/);
  if (newMatch) {
    const parentToken = newMatch[1];
    const folderNameMatch = locLine.match(/\/([^/\[]+)\s*\[/);
    const folderName = folderNameMatch ? folderNameMatch[1].trim() : "新建分类";
    const validParent = findByToken(parentToken) ? parentToken : folderTreeRoot.token;
    return { type: "new", parentToken: validParent, folderName, title };
  }

  // 现有文件夹
  const tokenMatch = locLine.match(/\[token:\s*([A-Za-z0-9]+)\]/);
  if (tokenMatch) {
    const token = tokenMatch[1];
    if (findByToken(token)) return { type: "existing", folderToken: token, title };
  }

  // fallback：技术知识库根
  return { type: "existing", folderToken: folderTreeRoot.token, title };
}

/** 从生成的 Markdown 里取首个 # 标题作为文档标题(取不到就用输入回退) */
export function extractTitle(markdown: string, fallback: string): string {
  const m = markdown.match(/^#\s+(.+)$/m);
  return (m?.[1] ?? fallback).trim();
}

export interface PipelineDeps {
  loadPrompt: (name: string) => string;
  runRole: (role: AgentRole, input: AgentInput) => Promise<string>;
  gate: Asker;              // 门1/门2/查重门共用同一个 Asker 实例
  publish: (markdown: string, placement: PlacementInfo) => Promise<string>; // 写飞书,返回文档 URL
  reviewMaxRetries?: number; // 审核打回上限,默认 2
  search?: (query: string) => Promise<string>;    // 联网搜索,返回已格式化上下文;不传则跳过
  dedup?: {
    search: (keyword: string) => Promise<SearchHit[]>; // 查重搜索
    merge: (userInput: string, target: SearchHit) => Promise<{ url: string; incrementalMarkdown: string }>;
  };
  updateIndex?: (title: string, url: string) => Promise<void>; // 每次 publish 后追加总索引一行
}

export interface PipelineResult {
  url: string;
  markdown: string;
  skeleton: string;
  feedbacks: GateFeedback[]; // 各道门中用户给出的非空修改意见,供 Distiller 使用
}

/**
 * 拼 system prompt:角色文件(+ 可选附上 style-rules)。
 * 内容组织/内容生成需要 style-rules 约束写作风格;问题分析/审核不需要。
 */
function buildSystem(loadPrompt: PipelineDeps["loadPrompt"], roleFile: string, withRules: boolean): string {
  const role = loadPrompt(roleFile);
  if (!withRules) return role;
  return `${role}\n\n---\n\n${loadPrompt("style-rules")}`;
}

/**
 * 门迭代:跑 role → 展示 → 收反馈。
 *
 * 循环逻辑:
 *   - gate 返回 "" → 通过,返回当前产出
 *   - gate 返回非空 → 把反馈拼进 user,记录到 collector,重跑 role
 *
 * baseUser 不变(保留原始任务上下文);每次迭代新 user 追加上一版产出 + 修改意见,
 * 让 agent 在看到完整历史的基础上修改。
 *
 * collector 可选,用于 Distiller:把每次非空反馈记录到 feedbacks 数组。
 */
async function iterateWithGate(
  deps: PipelineDeps,
  role: AgentRole,
  gateTitle: string,
  system: string,
  baseUser: string,
  collector?: (f: GateFeedback) => void,
): Promise<string> {
  let output = await deps.runRole(role, { system, user: baseUser });
  for (;;) {
    const reply = await deps.gate(gateTitle, output);
    if (reply === "") return output; // 通过
    collector?.({ gate: gateTitle, feedback: reply }); // 记录非空反馈
    const user = `${baseUser}\n\n【上一版产出】\n${output}\n\n【使用者修改意见】\n${reply}\n\n请据此修改后重新输出(保持同样的格式)。`;
    output = await deps.runRole(role, { system, user });
  }
}

/**
 * 完整流水线。
 *
 * 内容审核打回机制:
 *   contentReview agent 输出 "PASS" 则继续;输出 "FAIL ..." 则把问题拼进 user 重跑
 *   contentGeneration,最多 maxRetries 次。超出上限直接 publish(避免无限循环)。
 */
export async function runPipeline(userInput: string, deps: PipelineDeps): Promise<PipelineResult> {
  const maxRetries = deps.reviewMaxRetries ?? 2;
  const feedbacks: GateFeedback[] = []; // 收集所有门的非空反馈
  const collect = (f: GateFeedback) => feedbacks.push(f);

  // ① 问题分析 →门1(轻):确认范围/意图
  // 将可用文件夹目录注入 system prompt（替换占位符）
  const qaSystem = buildSystem(deps.loadPrompt, "question-analysis", false)
    .replace("{{FOLDER_TREE}}", renderFolderTree());
  const outline1 = await iterateWithGate(
    deps, "questionAnalysis", "门1 · 确认范围/意图", qaSystem, userInput, collect,
  );

  // 门1通过后，从 questionAnalysis 输出中解析归档位置和文档标题
  const placement = parsePlacement(outline1, userInput);

  // 查重分流:从问题分析产出里提取关键词 → 搜旧文 → 有候选才弹查重门
  if (deps.dedup) {
    const keywords = parseDedupKeywords(outline1);
    const candidates = keywords.length
      ? await searchDuplicates(keywords, { search: deps.dedup.search })
      : [];
    if (candidates.length > 0) {
      const reply = await deps.gate("查重 · 发现相关旧文档", formatDedupPrompt(candidates));
      const choice = parseGateChoice(reply, candidates);
      if (choice.action === "merge") {
        try {
          const { url, incrementalMarkdown } = await deps.dedup.merge(userInput, choice.target);
          // 合并成功:提前返回旧文档的 url,不走新建流程
          return { url, markdown: incrementalMarkdown, skeleton: "", feedbacks };
        } catch (e) {
          // 合并失败:打印警告,降级继续新建流程(不丢用户的研究内容)
          console.error(`  ⚠ 合并失败,降级为新建:${(e as Error).message}`);
        }
      }
    }
  }

  // 联网搜索:搜一次,结果顺流水线下传(注入到组织和生成的 user prompt)
  // 失败时优雅降级:不中断流水线,只是生成内容不含最新资料
  let searchContext = "";
  if (deps.search) {
    try {
      searchContext = await deps.search(userInput);
    } catch (e) {
      console.error(`  ⚠ 联网搜索失败,降级为纯模型作答:${(e as Error).message}`);
      searchContext = "";
    }
  }
  // 工具函数:有搜索结果时追加到 base 末尾;没有时原样返回
  const withSearch = (base: string) => (searchContext ? `${base}\n\n${searchContext}` : base);

  // ② 内容组织 →门2(重):确认三级骨架(输入含问题分析产出 + 搜索结果)
  const orgSystem = buildSystem(deps.loadPrompt, "content-organization", true);
  const orgUser = withSearch(`${userInput}\n\n【已确认的范围与意图】\n${outline1}`);
  const skeleton = await iterateWithGate(
    deps, "contentOrganization", "门2 · 确认骨架", orgSystem, orgUser, collect,
  );

  // ③ 内容生成(输入含骨架 + 搜索结果;maxTokens=32000 所以必须用 streaming)
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
    if (/^\s*PASS/.test(verdict)) break; // 通过,退出审核循环
    // 把审核问题拼进 user,让生成 agent 针对性修补
    markdown = await deps.runRole("contentGeneration", {
      system: genSystem,
      user: `${genUser}\n\n【上一版正文】\n${markdown}\n\n【审核问题】\n${verdict}\n\n请修补后重新输出完整正文。`,
    });
  }

  const url = await deps.publish(markdown, placement);

  if (deps.updateIndex) {
    const title = extractTitle(markdown, userInput);
    try {
      await deps.updateIndex(title, url);
    } catch (e) {
      console.error(`  ⚠ 索引更新失败,跳过:${(e as Error).message}`);
    }
  }

  return { url, markdown, skeleton, feedbacks };
}
