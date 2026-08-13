/**
 * tools/lark.ts — 飞书 CLI(lark-cli / ft-lark-cli)的封装
 *
 * 所有飞书操作通过注入的 CliRunner 执行,不直接调用 shell。
 * 这样测试时传 fake runner 即可,不依赖真实的 lark-cli 安装。
 *
 * 内容为什么走 stdin(--content -)而不是参数:
 *   Markdown/XML/SVG 内容可能含特殊字符(引号、反斜杠、换行),
 *   通过命令行参数传递需要复杂的 shell 转义;stdin 完全绕开这个问题。
 *   spawn 比 execFile 更方便写入 stdin(可以直接 child.stdin.write)。
 *
 * 模块分三组能力:
 *   1. 创建文档(+create)
 *   2. 更新文档(+update str_replace)
 *   3. 查重/读大纲/锚点插入(Plan 2d 新增)
 */

import { spawn } from "node:child_process";

export type DocFormat = "xml" | "markdown";

// ── 执行器 ────────────────────────────────────────────────────────────────────

/**
 * 注入型执行器接口:给定命令 + argv + 可选 stdin,返回 stdout 字符串。
 * 测试里用 vi.fn() 替代,无需安装真实 lark-cli。
 */
export type CliRunner = (cmd: string, args: string[], stdin?: string) => Promise<string>;

/**
 * 默认执行器:spawn 子进程,把 content 写入 stdin,收集 stdout。
 *
 * 用 spawn 而非 execFile 的原因:execFile 不方便在进程启动后写入 stdin,
 * 而 spawn 的 stdio: ["pipe",...] 返回可写的 child.stdin 流。
 * stderr 也收集起来,方便在进程以非 0 退出时拼进错误信息。
 */
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
    child.stdin.end(); // 必须 end(),否则子进程一直等 stdin 而不退出
  });

// ── 创建文档 ──────────────────────────────────────────────────────────────────

/** 构造 `lark-cli docs +create` 的 argv;内容从 stdin 读(--content -,避开 shell 转义) */
export function buildCreateDocArgs(format: DocFormat = "markdown", parentToken?: string): string[] {
  const args = ["docs", "+create", "--doc-format", format, "--content", "-", "--as", "user"];
  if (parentToken) args.push("--parent-token", parentToken);
  return args;
}

/**
 * 创建飞书文档,返回文档 URL。
 *
 * content 经 stdin 传入,默认 markdown 格式(飞书会把 # ## ### 等渲染成原生标题块)。
 * 解析 JSON 响应;ok 为 false 时抛出含 error.message 的错误。
 */
export async function larkCreateDoc(
  content: string,
  format: DocFormat = "markdown",
  parentToken?: string,
  runner: CliRunner = defaultRunner,
): Promise<string> {
  const stdout = await runner("lark-cli", buildCreateDocArgs(format, parentToken), content);
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

// ── 新建文件夹 ────────────────────────────────────────────────────────────────

/** 在指定父文件夹下新建文件夹，返回新文件夹 token */
export async function larkCreateFolder(
  name: string,
  parentToken: string,
  runner: CliRunner = defaultRunner,
): Promise<string> {
  const args = ["drive", "+create-folder", "--name", name, "--folder-token", parentToken, "--as", "user"];
  const stdout = await runner("lark-cli", args);
  let parsed: { ok?: boolean; data?: { token?: string }; error?: { message?: string } };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`lark-cli 返回非 JSON 输出:${stdout.slice(0, 200)}`);
  }
  if (!parsed.ok) throw new Error(`飞书新建文件夹失败:${parsed.error?.message ?? "unknown"}`);
  const token = parsed.data?.token;
  if (!token) throw new Error("飞书返回中缺少文件夹 token");
  return token;
}

// ── 更新文档(str_replace) ─────────────────────────────────────────────────────

/**
 * 构造 `docs +update --command str_replace` 的 argv。
 * str_replace 把文档里第一个匹配 pattern 的文本块替换成 content(stdin 传入)。
 * 用途:把【配图指令:...】占位文本替换成 <whiteboard type="svg">...</whiteboard> 画板块。
 * 默认 xml 格式,因为 <whiteboard> 是飞书原生 XML 标签而非 Markdown 语法。
 */
export function buildUpdateStrReplaceArgs(docUrl: string, pattern: string, format: DocFormat = "xml"): string[] {
  return [
    "docs",
    "+update",
    "--doc", docUrl,
    "--command", "str_replace",
    "--pattern", pattern,
    "--content", "-",
    "--doc-format", format,
    "--as", "user",
  ];
}

/**
 * 用 str_replace 把文档里的 pattern 文本替换成 content。
 * 典型用途:把配图占位符替换成飞书画板 SVG。
 */
export async function larkUpdateStrReplace(
  docUrl: string,
  pattern: string,
  content: string,
  runner: CliRunner = defaultRunner,
): Promise<void> {
  const stdout = await runner("lark-cli", buildUpdateStrReplaceArgs(docUrl, pattern), content);
  let parsed: { ok?: boolean; error?: { message?: string } };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`lark-cli 返回非 JSON 输出:${stdout.slice(0, 200)}`);
  }
  if (!parsed.ok) {
    throw new Error(`飞书更新文档失败:${parsed.error?.message ?? "unknown"}`);
  }
}

// ── 查重去重合并 ──────────────────────────────────────────────────────────────

export interface SearchOpts {
  mine?: boolean;      // --mine:锁定本人知识库。查重必须开启,否则会召回全租户同名文档
  onlyTitle?: boolean; // --only-title:只搜标题,精准判断"是否已有此主题"
}

export interface SearchHit {
  title: string; // 去掉 <h> 高亮标签后的文档标题
  url: string;   // 文档 URL,用于 fetch outline / block_insert_after
  token: string; // 文档唯一标识,用于去重(多个关键词命中同一篇时只保留一条)
}

/** 构造 `drive +search` argv(按需带 --only-title / --mine) */
export function buildSearchArgs(query: string, opts: SearchOpts = {}): string[] {
  const args = ["drive", "+search", "--query", query];
  if (opts.onlyTitle) args.push("--only-title");
  if (opts.mine) args.push("--mine");
  return args;
}

/**
 * 搜索飞书文档,返回本人的 DOCX 候选列表。
 *
 * 过滤逻辑:
 * - doc_types !== "DOCX" 的结果过滤掉(排除文件夹等非文档类型)
 * - title_highlighted 含 <h>关键词</h> 高亮标签,去掉后返回纯文本标题
 */
export async function larkSearchDocs(
  query: string,
  opts: SearchOpts = {},
  runner: CliRunner = defaultRunner,
): Promise<SearchHit[]> {
  const stdout = await runner("lark-cli", buildSearchArgs(query, opts));
  let parsed: {
    ok?: boolean;
    data?: {
      results?: Array<{
        title_highlighted?: string;
        result_meta?: { url?: string; token?: string; doc_types?: string };
      }>;
    };
    error?: { message?: string };
  };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`lark-cli 返回非 JSON 输出:${stdout.slice(0, 200)}`);
  }
  if (!parsed.ok) throw new Error(`飞书搜索失败:${parsed.error?.message ?? "unknown"}`);
  return (parsed.data?.results ?? [])
    .filter((r) => r.result_meta?.doc_types === "DOCX") // 只保留真实文档
    .map((r) => ({
      title: (r.title_highlighted ?? "").replace(/<\/?h>/g, ""), // 去掉 <h> 高亮标签
      url: r.result_meta?.url ?? "",
      token: r.result_meta?.token ?? "",
    }));
}

// ── 读大纲 ────────────────────────────────────────────────────────────────────

/** 构造 `docs +fetch --scope outline` argv */
export function buildFetchOutlineArgs(docUrl: string): string[] {
  return ["docs", "+fetch", "--doc", docUrl, "--scope", "outline"];
}

/**
 * 读取文档大纲:返回含 <h2 id="block_id"> 等标题的文本。
 *
 * --scope outline 只返回标题层级(不含正文),响应体更小,且 block_id 稳定不变。
 * 增量合并 agent 读取这个大纲后,判断新知识应插在哪个小节后面,返回锚点 block_id。
 */
export async function larkFetchOutline(docUrl: string, runner: CliRunner = defaultRunner): Promise<string> {
  const stdout = await runner("lark-cli", buildFetchOutlineArgs(docUrl));
  let parsed: { ok?: boolean; data?: { document?: { content?: string } }; error?: { message?: string } };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`lark-cli 返回非 JSON 输出:${stdout.slice(0, 200)}`);
  }
  if (!parsed.ok) throw new Error(`飞书读取大纲失败:${parsed.error?.message ?? "unknown"}`);
  return parsed.data?.document?.content ?? "";
}

/** 读取文档完整 Markdown 正文（含【配图指令:...】占位符等原始内容）*/
export async function larkFetchDocContent(docUrl: string, runner: CliRunner = defaultRunner): Promise<string> {
  const args = ["docs", "+fetch", "--doc", docUrl, "--scope", "full", "--doc-format", "markdown"];
  const stdout = await runner("lark-cli", args);
  let parsed: { ok?: boolean; data?: { document?: { content?: string } }; error?: { message?: string } };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`lark-cli 返回非 JSON 输出:${stdout.slice(0, 200)}`);
  }
  if (!parsed.ok) throw new Error(`飞书读取文档内容失败:${parsed.error?.message ?? "unknown"}`);
  return parsed.data?.document?.content ?? "";
}

// ── 锚点插入 ──────────────────────────────────────────────────────────────────

/**
 * 构造 `docs +update --command block_insert_after` argv;内容从 stdin 读。
 *
 * block_insert_after 在指定 block_id 的块之后插入新内容,不覆盖已有内容。
 * 这是增量合并的核心操作:把新小节精确插到旧文相关章节的末尾。
 */
export function buildBlockInsertAfterArgs(docUrl: string, blockId: string, format: DocFormat = "markdown"): string[] {
  return [
    "docs",
    "+update",
    "--doc", docUrl,
    "--command", "block_insert_after",
    "--block-id", blockId,
    "--content", "-",
    "--doc-format", format,
    "--as", "user",
  ];
}

// ── 末尾追加 ──────────────────────────────────────────────────────────────────

/** 构造 `docs +update --mode append` argv;内容从 stdin 读。
 * lark-cli 1.0.0 把 --command 改成 --mode,--content 改成 --markdown,--doc-format 移除。
 */
export function buildAppendToDocArgs(docToken: string): string[] {
  return [
    "docs",
    "+update",
    "--doc", docToken,
    "--mode", "append",
    "--markdown", "-",
    "--as", "user",
  ];
}

/**
 * 把 Markdown 内容追加到文档末尾。
 * 用于总索引文档追加新发布的文档行:`| 标题 | 分类 | [链接](url) | 日期 |`。
 */
export async function larkAppendToDoc(
  docToken: string,
  content: string,
  runner: CliRunner = defaultRunner,
): Promise<void> {
  const stdout = await runner("lark-cli", buildAppendToDocArgs(docToken), content);
  let parsed: { ok?: boolean; error?: { message?: string } };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`lark-cli 返回非 JSON 输出:${stdout.slice(0, 200)}`);
  }
  if (!parsed.ok) throw new Error(`飞书追加内容失败:${parsed.error?.message ?? "unknown"}`);
}

/**
 * 往总索引文档追加一行 `| 标题 | 分类 | 链接 | 日期 |`，链接保留为可点击超链接。
 *
 * 为什么不用 larkAppendToDoc：lark-cli docs +update --mode append 把 markdown 当纯文本追加，
 * `[链接](url)` 不会解析成超链接 block，最终索引里"链接"二字不可点。
 * 这里直接走 docx block children API，构造带 text_element_style.link 的 text block，
 * 飞书会把 link 样式保留下来。
 *
 * 索引文档根 block 的 block_id 等于 document_id，children 挂在它下面。
 */
export async function larkAppendIndexRow(
  docToken: string,
  title: string,
  category: string,
  url: string,
  date: string,
  runner: CliRunner = defaultRunner,
): Promise<void> {
  const payload = JSON.stringify({
    index: -1,
    children: [{
      block_type: 2,
      text: {
        elements: [
          { text_run: { content: `| ${title} | ${category} | `, text_element_style: {} } },
          { text_run: { content: "链接", text_element_style: { link: { url } } } },
          { text_run: { content: ` | ${date} |`, text_element_style: {} } },
        ],
        style: {},
      },
    }],
  });
  const args = [
    "api", "POST",
    `/open-apis/docx/v1/documents/${docToken}/blocks/${docToken}/children`,
    "--data", payload,
    "--as", "user",
  ];
  const stdout = await runner("lark-cli", args);
  let parsed: { code?: number; msg?: string };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`lark-cli 返回非 JSON 输出:${stdout.slice(0, 200)}`);
  }
  if (parsed.code !== 0) throw new Error(`飞书索引追加失败:${parsed.msg ?? `code=${parsed.code}`}`);
}

/**
 * 在指定 block 之后插入 Markdown 内容。
 * 用于把增量(新小节)插到旧文某个标题锚点后,而不是追加到文档末尾。
 */
export async function larkBlockInsertAfter(
  docUrl: string,
  blockId: string,
  content: string,
  format: DocFormat = "markdown",
  runner: CliRunner = defaultRunner,
): Promise<void> {
  const stdout = await runner("lark-cli", buildBlockInsertAfterArgs(docUrl, blockId, format), content);
  let parsed: { ok?: boolean; error?: { message?: string } };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`lark-cli 返回非 JSON 输出:${stdout.slice(0, 200)}`);
  }
  if (!parsed.ok) throw new Error(`飞书插入内容失败:${parsed.error?.message ?? "unknown"}`);
}
