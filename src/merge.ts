/**
 * merge.ts — 增量合并:把新知识点插进旧文档的相关小节
 *
 * 流程:
 *   1. 读旧文档大纲(含 block_id)
 *   2. incrementalMerge agent 分析大纲 + 新知识点,输出"锚点 block_id + 增量 Markdown"
 *   3. block_insert_after 把增量插到锚点后
 *
 * 失败策略:
 *   - 任何步骤失败(outline 读取失败、agent 输出格式错、插入失败)都抛错
 *   - 上层(orchestrator)捕获后降级为新建文档,保证内容不丢失
 *
 * 增量内容也可包含【配图指令】占位符;
 * cli.ts 在 merge 完成后对增量跑 patchDiagrams,补齐配图。
 */

import type { AgentInput, AgentRole } from "./types.js";
import type { SearchHit } from "./tools/lark.js";

export interface MergeResult {
  url: string;               // 旧文档 URL(内容已被增量修改)
  anchorBlockId: string;     // 实际插入位置的 block_id
  incrementalMarkdown: string; // 插入的增量内容(供 patchDiagrams 处理配图)
}

/**
 * 解析增量 agent 的输出。
 *
 * 约定格式(来自 prompts/incremental-merge.md):
 *   锚点: DoxcnAbcXyz123
 *   ## 六、新增小节标题
 *   正文内容...
 *
 * 首行必须是 "锚点: <block_id>",其后的所有内容是增量 Markdown。
 * 解析失败时抛错,触发上层降级。
 */
export function parseMergeOutput(text: string): { anchorBlockId: string; incrementalMarkdown: string } {
  const m = text.match(/锚点[:：]\s*(\S+)\s*\n([\s\S]*)/);
  if (!m) throw new Error("增量输出缺少首行「锚点: <block_id>」");
  return { anchorBlockId: m[1].trim(), incrementalMarkdown: m[2].trim() };
}

export interface MergeDeps {
  loadPrompt: (name: string) => string;
  runRole: (role: AgentRole, input: AgentInput) => Promise<string>;
  fetchOutline: (docUrl: string) => Promise<string>;    // 读旧文档大纲
  insertAfter: (docUrl: string, blockId: string, content: string) => Promise<void>; // 锚点插入
}

/**
 * 完整合并流程:
 *   fetch outline → incrementalMerge agent → parseMergeOutput → insertAfter
 *
 * agent 的 system prompt 拼上 style-rules,确保增量内容符合统一写作风格。
 * agent 的 user prompt 包含:
 *   - 用户的原始问题(新知识点)
 *   - 旧文档的标题 + 大纲(含 block_id)
 *
 * 任何步骤失败均抛错,由调用方(orchestrator)决定是否降级为新建。
 */
export async function mergeIntoDoc(
  userInput: string,
  target: SearchHit,
  deps: MergeDeps,
): Promise<MergeResult> {
  // 读旧文档大纲,用于 agent 判断增量应插在哪个小节后
  const outline = await deps.fetchOutline(target.url);

  // system = incremental-merge 角色 prompt + style-rules(保持写作风格一致)
  const system = `${deps.loadPrompt("incremental-merge")}\n\n---\n\n${deps.loadPrompt("style-rules")}`;
  const user = `【新知识点】\n${userInput}\n\n【旧文档《${target.title}》大纲(含 block_id)】\n${outline}`;

  const out = await deps.runRole("incrementalMerge", { system, user });
  const { anchorBlockId, incrementalMarkdown } = parseMergeOutput(out);

  // 把增量插到锚点后(不覆盖,不追加末尾,精确定位到相关小节)
  await deps.insertAfter(target.url, anchorBlockId, incrementalMarkdown);

  return { url: target.url, anchorBlockId, incrementalMarkdown };
}
