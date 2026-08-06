/**
 * outlineBundle.ts — 门2「复制大纲」的剪贴板 bundle 组装
 *
 * 把本系统「内容生成 + 作图」的全部指令连同骨架拼成一段自包含文本，
 * 供使用者粘贴到外部 AI 中台一次性生成带图完整文档。纯函数，可单测。
 */

export interface BundleParts {
  question: string;      // 原始问题
  research: string;      // 联网研究 memo，可为空
  skeleton: string;      // 门2 确认/展示的骨架
  generation: string;    // content-generation.md 全文
  styleRules: string;    // style-rules.md 全文
  drawingRules: string;  // 精简 drawing-rules-ascii.md 全文
}

const SEP = (name: string) => `\n\n## ===== ${name} =====\n\n`;

// 覆盖 content-generation.md 里"写【配图指令】占位交给后续 agent"的指令：
// 本任务没有后续画图环节，中台需就地画图。
const DRAW_OVERRIDE =
  "配图处理（覆盖上文关于配图的说明）：本任务没有后续画图环节。" +
  "遇到需要图的地方，请**直接用字符图画进围栏代码块**（规范见下一段），" +
  "不要输出 `【配图指令:...】` 占位符。";

export function buildOutlineBundle(p: BundleParts): string {
  const framing =
    "请扮演资深技术作者，读者是一名前端工程师（懂后端、目标成为架构师）。" +
    "请严格按下面的【骨架】【方法论】【风格规则】【字符画图规范】，" +
    "输出一篇结构清晰、有推导、有类比、有代码与字符图的完整 Markdown 讲解文档。";

  let out = framing;
  out += SEP("原始问题") + p.question;
  if (p.research.trim()) out += SEP("联网研究资料（最新事实优先采信）") + p.research;
  out += SEP("已确认的骨架（含体量，严格按体量写足）") + p.skeleton;
  out += SEP("内容生成方法论") + p.generation;
  out += SEP("配图处理（覆盖指令）") + DRAW_OVERRIDE;
  out += SEP("回答风格规则") + p.styleRules;
  out += SEP("字符画图规范") + p.drawingRules;
  return out;
}
