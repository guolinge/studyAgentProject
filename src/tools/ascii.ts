/**
 * tools/ascii.ts — ASCII 字符图提取与校验
 *
 * 与 tools/svg.ts 平行：extractAsciiBlock 从 agent 输出取围栏代码块，
 * lintAscii 做务实校验（禁用 Unicode 制表符 / 行宽 / 非空），
 * 问题描述原样喂回作图 agent 做下一轮修正。
 */

/**
 * 从 agent 输出中提取第一个围栏代码块（```…```）的内容。
 * 支持带语言标注（```text）和裸围栏。
 * @throws 若找不到围栏代码块则抛错（调用方捕获后喂回 agent 修正）
 */
export function extractAsciiBlock(text: string): string {
  const m = text.match(/```[^\n]*\n([\s\S]*?)```/);
  if (!m) throw new Error("未找到围栏代码块(生成结果里应含一个 ```…``` 代码块)");
  return m[1].replace(/\n$/, "");
}

export interface AsciiLintResult {
  ok: boolean;
  issues: string[];
}

// 东亚宽字符近似判定：CJK 表意文字 / 全角标点 / Hangul 等按 2 列
function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0xa4cf) || // CJK 部首 … 表意文字
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul 音节
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK 兼容表意
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK 兼容符号
    (cp >= 0xff00 && cp <= 0xff60) || // 全角 ASCII
    (cp >= 0xffe0 && cp <= 0xffe6)    // 全角符号
  );
}

/** 一行的显示列宽（中文/全角按 2 列） */
export function displayWidth(line: string): number {
  let w = 0;
  for (const ch of line) w += isWide(ch.codePointAt(0)!) ? 2 : 1;
  return w;
}

// 飞书代码块渲染会把这些 Unicode 制表符/装饰符弄乱；LLM 最爱误用
const BANNED_UNICODE = /[─-╿■-◿]/;
const MAX_WIDTH = 100;

/**
 * 务实版 ASCII 图校验：
 *   ① 禁用 Unicode 制表符/装饰符
 *   ② 每行显示列宽 ≤ 100（中文按 2 列）
 *   ③ 内容非空
 * 不做 junction 对齐审计（太脆，靠 prompt 纪律）。
 */
export function lintAscii(ascii: string): AsciiLintResult {
  const issues: string[] = [];
  if (!ascii.trim()) {
    issues.push("图内容为空");
    return { ok: false, issues };
  }
  if (BANNED_UNICODE.test(ascii)) {
    issues.push("使用了禁用的 Unicode 制表符/装饰符(如 ┌─┐│●▶)，只能用 + - | > < ^ v");
  }
  const lines = ascii.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const w = displayWidth(lines[i]);
    if (w > MAX_WIDTH) {
      issues.push(`第 ${i + 1} 行宽 ${w} 列，超过 ${MAX_WIDTH} 列上限(中文按 2 列计)`);
    }
  }
  return { ok: issues.length === 0, issues };
}
