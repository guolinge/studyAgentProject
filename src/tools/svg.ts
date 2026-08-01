/**
 * tools/svg.ts — SVG 提取与飞书画板兼容性校验
 *
 * 飞书画板对 SVG 有严格约束:
 *   1. 必须有 viewBox(画板靠它确定尺寸,无则渲染成黑块)
 *   2. 样式必须内联(style="..." 属性),不能用 class=;飞书画板不加载外部 CSS
 *   3. 禁止 <pattern>/<mask>/<clipPath>/<foreignObject>(不支持)
 *   4. <filter> 只允许 feDropShadow;其他 fe* 滤镜不支持
 *
 * lintSvg() 校验上述规则,把问题描述返回给作图 agent 做修正(最多 2 轮重试)。
 */

/**
 * 从 agent 输出中提取第一个完整的 <svg>…</svg> 块。
 * agent 有时会在 SVG 前后加说明文字或用 ```svg 围栏包裹,都能正确提取。
 *
 * @throws 若找不到任何 <svg> 块则抛错(调用方捕获后把错误信息喂回 agent 修正)
 */
export function extractSvg(text: string): string {
  const m = text.match(/<svg[\s\S]*?<\/svg>/i);
  if (!m) throw new Error("未找到 <svg> 块(生成结果里应含一个完整的 <svg>…</svg>)");
  return m[0];
}

export interface LintResult {
  ok: boolean;
  issues: string[]; // 具体诊断文字,原样喂给作图 agent 做下一轮修正
}

// 飞书画板完全不支持的元素;出现任何一个都会导致渲染失败或被静默忽略
const FORBIDDEN = ["pattern", "mask", "clipPath", "foreignObject"];

/**
 * 校验 SVG 是否满足飞书画板的兼容性要求。
 *
 * 返回 { ok: true } 表示可以直接插入飞书;
 * 返回 { ok: false, issues } 表示需要修正,issues 描述具体问题。
 *
 * 注意:lintSvg 只做静态文本检查,无法判断坐标/颜色等语义正确性。
 */
export function lintSvg(svg: string): LintResult {
  const issues: string[] = [];

  // viewBox 缺失是最常见的问题:SVG 本身能渲染,但飞书画板不知道尺寸,显示黑块
  if (!/viewBox\s*=/.test(svg)) {
    issues.push("缺少 viewBox(飞书画板需要它确定尺寸)");
  }

  // class 属性依赖外部 CSS 才有效,飞书画板是沙盒环境,外部样式不生效
  if (/\sclass\s*=/.test(svg)) {
    issues.push("使用了 class(样式必须内联到元素属性,飞书画板不加载外部 CSS)");
  }

  // 逐一检查禁用元素
  for (const el of FORBIDDEN) {
    if (new RegExp(`<${el}[\\s>/]`, "i").test(svg)) {
      issues.push(`使用了飞书画板不支持的元素 <${el}>`);
    }
  }

  // filter 中:feDropShadow 是飞书支持的唯一滤镜;其他 fe* 滤镜(feBlur、feColorMatrix 等)不支持
  // 检测逻辑:有 <filter> 且存在非 feDropShadow 的 fe* 元素
  if (/<filter[\s>]/i.test(svg) && /<fe(?!DropShadow)[A-Za-z]/i.test(svg)) {
    issues.push("使用了非阴影 filter(飞书画板仅支持 feDropShadow)");
  }

  return { ok: issues.length === 0, issues };
}
