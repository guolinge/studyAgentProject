import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

/**
 * 一道门:展示 title + content,返回用户输入的一行(已归一化)。
 * 返回 "" 表示"通过";非空表示"修改意见"。
 * 抽成函数式接口便于 orchestrator 注入 fake 测试,不碰真实终端。
 */
export type Asker = (title: string, content: string) => Promise<string>;

/** 归一化门里的一行输入:去首尾空白(空白行等价于通过) */
export function normalizeReply(raw: string): string {
  return raw.trim();
}

const LINE = "─".repeat(60);

/**
 * 真实门:打印内容并从 stdin 读一行(回车通过 / 输入修改意见)。
 * 复用**单个** readline 实例——每道门都新建/关闭会导致管道 stdin 下第二道门读不到输入。
 * 用完记得调 `.close()`(挂在返回函数上)释放 stdin,否则进程不退出。
 */
export function createReadlineAsker(): Asker & { close: () => void } {
  const rl = createInterface({ input: stdin, output: stdout });
  const asker = async (title: string, content: string) => {
    stdout.write(`\n${LINE}\n【${title}】\n\n${content}\n${LINE}\n`);
    const answer = await rl.question("↳ 回车通过,或输入修改意见后回车:");
    return normalizeReply(answer);
  };
  asker.close = () => rl.close();
  return asker;
}
