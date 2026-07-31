import { execFile } from "node:child_process";

/** 构造 `lark-cli docs +create` 的 argv(不含 lark-cli 本身) */
export function buildCreateDocArgs(contentXml: string): string[] {
  return ["docs", "+create", "--content", contentXml, "--as", "user"];
}

// 注入型执行器:给定命令与参数,返回 stdout 字符串
export type CliRunner = (cmd: string, args: string[]) => Promise<string>;

/** 默认执行器:真正 spawn lark-cli */
export const defaultRunner: CliRunner = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${cmd} 执行失败:${stderr || err.message}`));
      resolve(stdout);
    });
  });

/** 创建飞书文档,返回文档 URL */
export async function larkCreateDoc(contentXml: string, runner: CliRunner = defaultRunner): Promise<string> {
  const stdout = await runner("lark-cli", buildCreateDocArgs(contentXml));
  const parsed = JSON.parse(stdout) as {
    ok?: boolean;
    data?: { document?: { url?: string } };
    error?: { message?: string };
  };
  if (!parsed.ok) {
    throw new Error(`飞书创建文档失败:${parsed.error?.message ?? "unknown"}`);
  }
  const url = parsed.data?.document?.url;
  if (!url) throw new Error("飞书返回中缺少 document.url");
  return url;
}
