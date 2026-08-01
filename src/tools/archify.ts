import { defaultRunner, type CliRunner } from "./lark.js";

// archify 支持的 5 类图
export type ArchifyType = "architecture" | "workflow" | "sequence" | "dataflow" | "lifecycle";

/** 构造 `node <bin> validate <type> <json> --json` 的 argv(不含 node 本身) */
export function buildValidateArgs(bin: string, type: ArchifyType | string, jsonPath: string): string[] {
  return [bin, "validate", type, jsonPath, "--json"];
}

/** 构造 `node <bin> render <type> <json> <out.html>` 的 argv */
export function buildRenderArgs(
  bin: string,
  type: ArchifyType | string,
  jsonPath: string,
  outPath: string,
): string[] {
  return [bin, "render", type, jsonPath, outPath];
}

export interface ValidateResult {
  ok: boolean;
  diagnostics: string; // 失败 check 汇总(name: details),供喂回图规划 agent 修正
}

/** 跑 archify validate --json,解析出 ok 与失败诊断 */
export async function archifyValidate(
  bin: string,
  type: ArchifyType | string,
  jsonPath: string,
  runner: CliRunner = defaultRunner,
): Promise<ValidateResult> {
  const out = await runner("node", buildValidateArgs(bin, type, jsonPath));
  const parsed = JSON.parse(out) as {
    ok?: boolean;
    checks?: { name: string; ok: boolean; details?: string[] }[];
  };
  const failed = (parsed.checks ?? []).filter((c) => !c.ok);
  const diagnostics = failed.map((c) => `${c.name}: ${(c.details ?? []).join("; ")}`).join("\n");
  return { ok: !!parsed.ok, diagnostics };
}

/** 跑 archify render,生成自包含 HTML,返回输出路径 */
export async function archifyRender(
  bin: string,
  type: ArchifyType | string,
  jsonPath: string,
  outPath: string,
  runner: CliRunner = defaultRunner,
): Promise<string> {
  await runner("node", buildRenderArgs(bin, type, jsonPath, outPath));
  return outPath;
}

/** 从 archify 输出的 HTML 里提取第一个 <svg> 块(用于插入飞书画板) */
export function extractSvg(html: string): string {
  const m = html.match(/<svg[\s\S]*?<\/svg>/);
  if (!m) throw new Error("archify 输出 HTML 中未找到 <svg> 块");
  return m[0];
}
