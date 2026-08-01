import type { AgentInput, AgentRole } from "./types.js";
import type { SearchHit } from "./tools/lark.js";

export interface MergeResult {
  url: string;
  anchorBlockId: string;
  incrementalMarkdown: string;
}

/** 解析增量 agent 的输出:首行 `锚点: <block_id>`,其后为增量 Markdown */
export function parseMergeOutput(text: string): { anchorBlockId: string; incrementalMarkdown: string } {
  const m = text.match(/锚点[:：]\s*(\S+)\s*\n([\s\S]*)/);
  if (!m) throw new Error("增量输出缺少首行「锚点: <block_id>」");
  return { anchorBlockId: m[1].trim(), incrementalMarkdown: m[2].trim() };
}

export interface MergeDeps {
  loadPrompt: (name: string) => string;
  runRole: (role: AgentRole, input: AgentInput) => Promise<string>;
  fetchOutline: (docUrl: string) => Promise<string>;
  insertAfter: (docUrl: string, blockId: string, content: string) => Promise<void>;
}

/**
 * 合并流程:读旧文大纲 → 增量 agent 产出{锚点,增量} → 把增量插到锚点后。
 * 锚点非法/插入失败会抛错,交上层降级为新建。
 */
export async function mergeIntoDoc(
  userInput: string,
  target: SearchHit,
  deps: MergeDeps,
): Promise<MergeResult> {
  const outline = await deps.fetchOutline(target.url);
  const system = `${deps.loadPrompt("incremental-merge")}\n\n---\n\n${deps.loadPrompt("style-rules")}`;
  const user = `【新知识点】\n${userInput}\n\n【旧文档《${target.title}》大纲(含 block_id)】\n${outline}`;
  const out = await deps.runRole("incrementalMerge", { system, user });
  const { anchorBlockId, incrementalMarkdown } = parseMergeOutput(out);
  await deps.insertAfter(target.url, anchorBlockId, incrementalMarkdown);
  return { url: target.url, anchorBlockId, incrementalMarkdown };
}
