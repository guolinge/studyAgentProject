// SVG 校验/提取:确保 agent 产出的 SVG 是自包含 + 飞书画板兼容的

/** 从 agent 输出(可能裹着 ```svg 围栏或说明文字)里提取第一个 <svg>…</svg> */
export function extractSvg(text: string): string {
  const m = text.match(/<svg[\s\S]*?<\/svg>/i);
  if (!m) throw new Error("未找到 <svg> 块(生成结果里应含一个完整的 <svg>…</svg>)");
  return m[0];
}

export interface LintResult {
  ok: boolean;
  issues: string[]; // 具体诊断,供喂回生成 agent 修正
}

// 飞书画板不支持的元素(见设计文档附录A)
const FORBIDDEN = ["pattern", "mask", "clipPath", "foreignObject"];

/** 校验 SVG 是否自包含 + 飞书画板兼容 */
export function lintSvg(svg: string): LintResult {
  const issues: string[] = [];

  if (!/viewBox\s*=/.test(svg)) {
    issues.push("缺少 viewBox(飞书画板需要它确定尺寸)");
  }
  if (/\sclass\s*=/.test(svg)) {
    issues.push("使用了 class(样式必须内联到元素属性,飞书画板不加载外部 CSS)");
  }
  for (const el of FORBIDDEN) {
    if (new RegExp(`<${el}[\\s>/]`, "i").test(svg)) {
      issues.push(`使用了飞书画板不支持的元素 <${el}>`);
    }
  }
  // filter 仅允许纯阴影(feDropShadow);出现其它 fe* 滤镜视为不支持
  if (/<filter[\s>]/i.test(svg) && /<fe(?!DropShadow)[A-Za-z]/i.test(svg)) {
    issues.push("使用了非阴影 filter(飞书画板仅支持 feDropShadow)");
  }

  return { ok: issues.length === 0, issues };
}
