import { extractSvg, lintSvg } from "./tools/svg.js";
import type { AgentInput, AgentRole } from "./types.js";

export interface DiagramSpec {
  raw: string; // 完整占位文本,含【】,用于替换
  instruction: string; // 配图指令描述
}

const SPEC_RE = /【配图指令[:：]([^】]*)】/g;

/** 从 markdown 里解析所有 【配图指令:...】 占位 */
export function extractDiagramSpecs(markdown: string): DiagramSpec[] {
  const specs: DiagramSpec[] = [];
  for (const m of markdown.matchAll(SPEC_RE)) {
    specs.push({ raw: m[0], instruction: m[1].trim() });
  }
  return specs;
}

export interface DiagramDeps {
  loadPrompt: (name: string) => string;
  runRole: (role: AgentRole, input: AgentInput) => Promise<string>;
  maxRetries?: number; // 校验失败重试上限,默认 2
}

/** 单条配图指令 → 校验通过的 SVG;两轮修正仍不过则返回 null(降级) */
export async function renderDiagram(
  spec: DiagramSpec,
  context: string,
  deps: DiagramDeps,
): Promise<string | null> {
  const system = `${deps.loadPrompt("diagram-svg")}\n\n---\n\n${deps.loadPrompt("drawing-rules")}`;
  const maxRetries = deps.maxRetries ?? 2;
  let feedback = "";
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const user = `【配图指令:${spec.instruction}】\n\n【上下文】\n${context}${feedback}`;
    const out = await deps.runRole("diagramSvg", { system, user });
    let svg: string;
    try {
      svg = extractSvg(out);
    } catch {
      feedback = "\n\n【上一版问题】没有输出有效的 <svg> 块,请只输出一个完整的 <svg>…</svg>。";
      continue;
    }
    const lint = lintSvg(svg);
    if (lint.ok) return svg;
    feedback = `\n\n【上一版校验未通过,请逐条修正后重出】\n${lint.issues.join("\n")}`;
  }
  return null;
}

/** 把 markdown 里所有配图指令替换成飞书画板 SVG;失败的保留原文字占位,不阻断整篇 */
export async function renderDiagrams(markdown: string, deps: DiagramDeps): Promise<string> {
  const specs = extractDiagramSpecs(markdown);
  // 给作图 agent 的上下文:去掉所有配图占位后的正文
  const context = markdown.replace(SPEC_RE, "").trim();
  let result = markdown;
  for (const spec of specs) {
    const svg = await renderDiagram(spec, context, deps);
    if (svg) {
      result = result.replace(spec.raw, `<whiteboard type="svg">${svg}</whiteboard>`);
    }
  }
  return result;
}
