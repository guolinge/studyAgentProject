import { spawn } from "node:child_process";

export type DocFormat = "xml" | "markdown";

/** 构造 `lark-cli docs +create` 的 argv;内容从 stdin 读(--content -,避开 shell 转义) */
export function buildCreateDocArgs(format: DocFormat = "markdown"): string[] {
  return ["docs", "+create", "--doc-format", format, "--content", "-", "--as", "user"];
}

// 注入型执行器:命令 + argv + 可选 stdin,返回 stdout 字符串
export type CliRunner = (cmd: string, args: string[], stdin?: string) => Promise<string>;

/** 默认执行器:spawn 进程,把 content 写入 stdin 后收集 stdout */
export const defaultRunner: CliRunner = (cmd, args, stdin) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => reject(new Error(`${cmd} 执行失败:${err.message}`)));
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`${cmd} 执行失败(exit ${code}):${stderr || stdout}`));
      resolve(stdout);
    });
    if (stdin !== undefined) child.stdin.write(stdin);
    child.stdin.end();
  });

/** 创建飞书文档,返回文档 URL。content 经 stdin 传入,默认 markdown 格式 */
export async function larkCreateDoc(
  content: string,
  format: DocFormat = "markdown",
  runner: CliRunner = defaultRunner,
): Promise<string> {
  const stdout = await runner("lark-cli", buildCreateDocArgs(format), content);
  let parsed: {
    ok?: boolean;
    data?: { document?: { url?: string } };
    error?: { message?: string };
  };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`lark-cli 返回非 JSON 输出:${stdout.slice(0, 200)}`);
  }
  if (!parsed.ok) {
    throw new Error(`飞书创建文档失败:${parsed.error?.message ?? "unknown"}`);
  }
  const url = parsed.data?.document?.url;
  if (!url) throw new Error("飞书返回中缺少 document.url");
  return url;
}
