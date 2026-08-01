/**
 * prompts.ts — prompt 文件的读取工具
 *
 * 所有 agent 的 system prompt 都存在 prompts/ 目录下的 .md 文件里。
 * 这样 prompt 的修改历史在 git 里可追溯,Distiller 写回规则时也直接编辑这些文件。
 *
 * 注意:readFileSync 相对 cwd 解析路径,应在项目根目录运行(npm start 默认如此)。
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const PROMPTS_DIR = "prompts";

/**
 * 读取 prompts/<name>.md 的全文并返回。
 *
 * @param name   文件名(不含扩展名),如 "style-rules"、"question-analysis"
 * @param dir    prompt 目录,默认 "prompts";测试时可传临时目录
 * @throws       文件不存在时抛出带路径信息的错误(避免静默返回空字符串)
 */
export function loadPrompt(name: string, dir = PROMPTS_DIR): string {
  const path = join(dir, `${name}.md`);
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new Error(`无法加载 prompt "${name}"(期望路径:${path})`);
  }
}
