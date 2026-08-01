/**
 * dedup.ts — 查重去重:搜索、展示候选、解析用户选择
 *
 * 流程:
 *   1. 问题分析 agent 在输出里的 "## 查重关键词" 段落列出 3~5 个核心词
 *   2. parseDedupKeywords() 提取这些词
 *   3. searchDuplicates() 逐词搜索,按 token 去重(同一篇被多词命中只保留一条)
 *   4. formatDedupPrompt() 把候选格式化成门展示文本
 *   5. parseGateChoice() 解析用户输入:数字序号→合并该篇;空/越界→新建
 *
 * 搜索策略:
 * - 必须逐词搜索(不拼多词短语),多词短语会被飞书搜索当整体匹配,命中率极低
 * - 用 --only-title --mine:锁定本人标题精准搜索,避免召回全租户的相关文档
 * - query 长度 ≤30 字:飞书搜索超长 query 会静默截断
 */

import type { SearchHit } from "./tools/lark.js";

/**
 * 从问题分析 agent 的输出里提取"查重关键词"列表。
 *
 * 期望格式(来自 prompts/question-analysis.md):
 *   ## 查重关键词
 *   - pnpm
 *   - 硬链接
 *   - symlink
 *
 * 提取逻辑:找到 ## 查重关键词 段落,提取其中的 bullet,过滤掉超过 30 字的词。
 * 为什么过滤超 30 字:飞书搜索对长 query 有静默截断,超长词通常是 agent 拼出的短语。
 */
export function parseDedupKeywords(qaOutput: string): string[] {
  // 匹配 ## 查重关键词 到下一个 ## 或文件末尾
  const m = qaOutput.match(/##\s*查重关键词[^\n]*\n([\s\S]*?)(?:\n##\s|$)/);
  if (!m) return [];
  return m[1]
    .split("\n")
    .map((l) => l.replace(/^\s*[-*]\s*/, "").trim()) // 去掉 "- " 前缀
    .filter((l) => l.length > 0 && l.length <= 30);  // 过滤空行和超长词
}

export interface DedupDeps {
  search: (keyword: string) => Promise<SearchHit[]>;
}

/**
 * 逐词搜索,按 token 去重合并候选。
 *
 * 去重原因:同一篇文档可能被多个关键词命中(如"pnpm"和"硬链接"都命中《pnpm 原理》),
 * 按 token 去重确保每篇文档在候选列表里只出现一次。
 *
 * 串行搜索(非并发):飞书搜索接口无明显延迟,且串行更易调试。
 */
export async function searchDuplicates(keywords: string[], deps: DedupDeps): Promise<SearchHit[]> {
  const byToken = new Map<string, SearchHit>(); // token → 第一次命中的结果
  for (const kw of keywords) {
    const hits = await deps.search(kw);
    for (const h of hits) {
      // token 已存在时跳过(保留第一次命中的条目)
      if (h.token && !byToken.has(h.token)) byToken.set(h.token, h);
    }
  }
  return [...byToken.values()];
}

export type GateChoice = { action: "merge"; target: SearchHit } | { action: "new" };

/**
 * 把候选文档列表格式化成查重门的展示文本。
 *
 * 示例输出:
 *   发现可能相关的旧文档:
 *   1. pnpm 原理
 *      https://futu.feishu.cn/docx/xxx
 *   2. npm vs pnpm 对比
 *      https://futu.feishu.cn/docx/yyy
 *
 *   输入序号=合并进该篇;回车=新建独立文档。
 */
export function formatDedupPrompt(candidates: SearchHit[]): string {
  const lines = candidates.map((c, i) => `${i + 1}. ${c.title}\n   ${c.url}`);
  return `发现可能相关的旧文档:\n${lines.join("\n")}\n\n输入序号=合并进该篇;回车=新建独立文档。`;
}

/**
 * 解析查重门的用户输入,返回操作类型。
 *
 * 解析规则:
 * - 有效整数序号(1~candidates.length) → merge(合并进对应文档)
 * - 空字符串、非数字、越界数字 → new(新建独立文档)
 *
 * 宽松解析的原因:用户可能只看一眼就回车,或输入"n"/"不"表示新建,
 * 统一把不符合序号格式的都视为新建,避免误合并。
 */
export function parseGateChoice(reply: string, candidates: SearchHit[]): GateChoice {
  const n = Number.parseInt(reply.trim(), 10);
  if (Number.isInteger(n) && n >= 1 && n <= candidates.length) {
    return { action: "merge", target: candidates[n - 1] };
  }
  return { action: "new" };
}
