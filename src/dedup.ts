import type { SearchHit } from "./tools/lark.js";

/** 从问题分析产出里提取「查重关键词」列表(该节下的 bullet) */
export function parseDedupKeywords(qaOutput: string): string[] {
  const m = qaOutput.match(/##\s*查重关键词[^\n]*\n([\s\S]*?)(?:\n##\s|$)/);
  if (!m) return [];
  return m[1]
    .split("\n")
    .map((l) => l.replace(/^\s*[-*]\s*/, "").trim())
    .filter((l) => l.length > 0 && l.length <= 30);
}

export interface DedupDeps {
  search: (keyword: string) => Promise<SearchHit[]>;
}

/** 逐词查重,按 token 去重合并候选(同一篇被多词命中只留一条) */
export async function searchDuplicates(keywords: string[], deps: DedupDeps): Promise<SearchHit[]> {
  const byToken = new Map<string, SearchHit>();
  for (const kw of keywords) {
    const hits = await deps.search(kw);
    for (const h of hits) {
      if (h.token && !byToken.has(h.token)) byToken.set(h.token, h);
    }
  }
  return [...byToken.values()];
}

export type GateChoice = { action: "merge"; target: SearchHit } | { action: "new" };

/** 查重门展示文本:列出候选(1-based 序号 + 标题 + url) */
export function formatDedupPrompt(candidates: SearchHit[]): string {
  const lines = candidates.map((c, i) => `${i + 1}. ${c.title}\n   ${c.url}`);
  return `发现可能相关的旧文档:\n${lines.join("\n")}\n\n输入序号=合并进该篇;回车=新建独立文档。`;
}

/** 解析查重门输入:范围内数字序号→合并该候选;空/非数字/越界→新建 */
export function parseGateChoice(reply: string, candidates: SearchHit[]): GateChoice {
  const n = Number.parseInt(reply.trim(), 10);
  if (Number.isInteger(n) && n >= 1 && n <= candidates.length) {
    return { action: "merge", target: candidates[n - 1] };
  }
  return { action: "new" };
}
