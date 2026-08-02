/**
 * diagrams.ts — 配图编排:从 Markdown 占位符到飞书画板
 *
 * 配图指令格式(嵌在正文 Markdown 里):
 *   【配图指令:画一张展示 Event Loop 宏任务/微任务队列的时序图】
 *
 * 两种使用场景:
 *   1. renderDiagrams() — dry-run 或内联渲染:把占位符替换成 SVG(不写飞书)
 *   2. patchDiagrams()  — 正式流程:文档已建好,异步补图
 *
 * patchDiagrams 的并行策略:
 *   - 所有图的 SVG 生成并行进行(Promise.all),哪张先画完先排队更新
 *   - 飞书 update 操作串行(updateChain):避免多个并发 update 产生 revision 冲突
 *   - 效果:用户看到文字文档后,图片陆续补上(不是等所有图都画完才一起出现)
 */

import { extractSvg, lintSvg } from "./tools/svg.js";
import type { AgentInput, AgentRole } from "./types.js";

export interface DiagramSpec {
  raw: string;         // 完整占位文本(含【】),用于 str_replace 定位
  instruction: string; // 配图指令描述(不含【配图指令:】前缀)
}

// 匹配【配图指令:...】的正则;全局 flag 用于 matchAll
const SPEC_RE = /【配图指令[:：]([^】]*)】/g;

/**
 * 从 Markdown 里解析所有 【配图指令:...】 占位。
 * matchAll 返回所有命中,每条对应一张图。
 */
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
  maxRetries?: number; // SVG 校验失败后最多重试几次,默认 2
}

/**
 * 单条配图指令 → 校验通过的 SVG 字符串。
 *
 * 重试策略:
 *   - 第一轮:直接生成
 *   - 校验失败:把具体问题(lintSvg 的 issues)拼进 feedback,让 agent 修正
 *   - 超过 maxRetries 仍未通过 → 返回 null(调用方保留文字占位,不阻断整篇文档)
 *
 * context 是去掉所有占位符后的正文,给 agent 理解配图应画什么内容。
 */
export async function renderDiagram(
  spec: DiagramSpec,
  context: string,
  deps: DiagramDeps,
): Promise<string | null> {
  // system = SVG 生成角色 prompt + drawing-rules(飞书兼容约束 + 审美规范)
  const system = `${deps.loadPrompt("diagram-svg")}\n\n---\n\n${deps.loadPrompt("drawing-rules")}`;
  const maxRetries = deps.maxRetries ?? 2;
  let feedback = ""; // 上一轮的问题描述,空字符串表示第一次尝试

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const user = `【配图指令:${spec.instruction}】\n\n【上下文】\n${context}${feedback}`;
    const out = await deps.runRole("diagramSvg", { system, user });

    let svg: string;
    try {
      svg = extractSvg(out); // 从 agent 输出中提取 <svg>...</svg>
    } catch {
      // agent 没有输出有效 SVG 块,告知并重试
      feedback = "\n\n【上一版问题】没有输出有效的 <svg> 块,请只输出一个完整的 <svg>…</svg>。";
      continue;
    }

    const lint = lintSvg(svg);
    if (lint.ok) return svg; // 校验通过,返回

    // 把校验问题逐条告诉 agent,让它在下一轮修正
    feedback = `\n\n【上一版校验未通过,请逐条修正后重出】\n${lint.issues.join("\n")}`;
  }
  return null; // 超出重试次数,降级
}

/**
 * 把 Markdown 里所有配图指令替换成飞书画板 SVG(串行,用于 dry-run/内联渲染)。
 * 失败的保留原文字占位,不阻断整篇文档。
 */
export async function renderDiagrams(markdown: string, deps: DiagramDeps): Promise<string> {
  const specs = extractDiagramSpecs(markdown);
  // 去掉所有占位符后的正文,作为每张图的上下文
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

export interface PatchDeps extends DiagramDeps {
  updateDoc: (docUrl: string, pattern: string, content: string) => Promise<void>;
  onProgress?: (msg: string) => void;
  onError?: (instruction: string, reason: string) => void; // 单张图失败回调（问题8）
}

/**
 * 先文字后补图:文档已建好(含占位符),并行生成所有图,串行写入飞书。
 *
 * 并行 + 串行的实现:
 *   - renders = specs.map(spec => renderDiagram(...).then(svg => { updateChain = updateChain.then(...) }))
 *   - 每张图生成完后,立刻把自己的 update 追加到 updateChain 末尾
 *   - updateChain 是一条串行 Promise 链,保证 update 不并发
 *   - Promise.all(renders) 等所有图生成完
 *   - await updateChain 等最后一个 update 完成
 *
 * 为什么 update 必须串行:
 *   飞书文档有 revision 机制,多个并发 update 会互相覆盖,只有最后一个生效。
 *   串行确保每次 update 基于最新 revision。
 */
export async function patchDiagrams(
  markdown: string,
  docUrl: string,
  deps: PatchDeps,
): Promise<{ total: number; patched: number }> {
  const specs = extractDiagramSpecs(markdown);
  const context = markdown.replace(SPEC_RE, "").trim();
  let patched = 0;

  // updateChain:串行执行飞书 update,初始是已完成的 Promise
  let updateChain: Promise<void> = Promise.resolve();

  // 每张图独立生成(并行);生成完后追加进 update 队列
  const renders = specs.map((spec, i) =>
    renderDiagram(spec, context, deps).then((svg) => {
      if (!svg) {
        deps.onProgress?.(`  ⚠ 第 ${i + 1}/${specs.length} 张校验未过,保留文字占位:${spec.instruction}`);
        deps.onError?.(spec.instruction, "SVG 校验超出重试次数");
        return;
      }
      // 追加到串行链末尾:等前一个 update 完成后再执行本次 update
      updateChain = updateChain.then(async () => {
        await deps.updateDoc(docUrl, spec.raw, `<whiteboard type="svg">${svg}</whiteboard>`);
        patched++;
        deps.onProgress?.(`  ✅ 已补 ${patched}/${specs.length} 张:${spec.instruction}`);
      });
    }),
  );

  await Promise.all(renders); // 等所有图生成完毕(update 可能还没跑完)
  await updateChain;          // 等最后一个 update 完成
  return { total: specs.length, patched };
}
