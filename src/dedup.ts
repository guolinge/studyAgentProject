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
