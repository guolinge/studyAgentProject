import type { AgentInput } from "./types.js";

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 从生成的 Markdown 里取首个 # 标题作为文档标题(取不到就用输入回退) */
function extractTitle(markdown: string, fallback: string): string {
  const m = markdown.match(/^#\s+(.+)$/m);
  return (m?.[1] ?? fallback).trim();
}

/**
 * 把生成结果包成飞书 docs +create 接受的最小 XML。
 * Plan 1 只做:标题 + 正文塞进一个段落(正文按原样保留,换行转 <br/>)。
 */
export function markdownToDocXml(title: string, body: string): string {
  const safeTitle = escapeXml(title);
  const safeBody = escapeXml(body).replace(/\n/g, "<br/>");
  return `<title>${safeTitle}</title><p>${safeBody}</p>`;
}

export interface SkeletonDeps {
  generate: (input: AgentInput) => Promise<string>;
  publish: (contentXml: string) => Promise<string>;
  loadPrompt: (name: string) => string;
}

export interface SkeletonResult {
  url: string;
  markdown: string;
}

/** 骨架链路:输入 → 生成(角色prompt+规则) → 包成飞书 XML → 写飞书 → 返回 URL */
export async function runSkeleton(userInput: string, deps: SkeletonDeps): Promise<SkeletonResult> {
  const role = deps.loadPrompt("content-generation");
  const rules = deps.loadPrompt("style-rules");
  const system = `${role}\n\n---\n\n${rules}`;

  const markdown = await deps.generate({ system, user: userInput });
  const title = extractTitle(markdown, userInput);
  const xml = markdownToDocXml(title, markdown);
  const url = await deps.publish(xml);
  return { url, markdown };
}
