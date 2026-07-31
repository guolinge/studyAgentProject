import { readFileSync } from "node:fs";
import { join } from "node:path";

const PROMPTS_DIR = "prompts";

/** 读取 prompts/<name>.md 的全文 */
export function loadPrompt(name: string, dir = PROMPTS_DIR): string {
  const path = join(dir, `${name}.md`);
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new Error(`无法加载 prompt "${name}"(期望路径:${path})`);
  }
}
