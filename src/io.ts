/**
 * io.ts — 人工确认门的终端交互
 *
 * 抽成函数式接口(Asker),使 orchestrator 无需直接依赖 readline,
 * 测试时注入 vi.fn() 即可模拟用户输入。
 *
 * 真实门(createReadlineAsker)的关键约束:
 *   复用单个 readline 实例,不在每道门创建/关闭。
 *   原因:在管道输入场景(echo "..." | npm start)下,close() 会消费掉整个 stdin。
 *   第二道门再 createInterface 时 stdin 已 EOF,永远读不到内容。
 *   解决方案:整个进程生命周期内只创建一次,cli.ts 在 finally 块里调用 .close()。
 */

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

/**
 * 一道门的函数签名:展示 title + content,返回用户输入的一行(已归一化)。
 * 返回 "" 表示"通过";非空字符串表示"修改意见",上游 agent 据此重跑。
 */
export type Asker = (title: string, content: string) => Promise<string>;

/**
 * 归一化门输入:去首尾空白。
 * 这样用户敲回车(产生 "\n" 或 "")和输入空格后回车都统一视为"通过"。
 */
export function normalizeReply(raw: string): string {
  return raw.trim();
}

const LINE = "─".repeat(60);

/**
 * 创建真实的终端门交互器。
 *
 * 用法:
 *   const asker = createReadlineAsker();
 *   try {
 *     // 传给 runPipeline,每道门调用一次
 *   } finally {
 *     asker.close(); // 释放 stdin,让 Node 进程正常退出
 *   }
 *
 * .close() 方法挂在返回的 asker 函数上,方便 cli.ts 在 finally 里调用。
 */
export function createReadlineAsker(): Asker & { close: () => void } {
  // 整个流水线共用一个 rl 实例(参见文件顶部注释)
  const rl = createInterface({ input: stdin, output: stdout });

  const asker = async (title: string, content: string) => {
    // 用分隔线 + 门标题突出显示,让用户清晰知道当前在哪道门
    stdout.write(`\n${LINE}\n【${title}】\n\n${content}\n${LINE}\n`);
    const answer = await rl.question("↳ 回车通过,或输入修改意见后回车:");
    return normalizeReply(answer);
  };

  asker.close = () => rl.close();
  return asker;
}
