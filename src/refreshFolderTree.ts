/**
 * refreshFolderTree.ts — 重新拉取飞书文件夹树，更新 config/folder-tree.json
 *
 * 尝试用 lark-cli drive files list 递归枚举子文件夹。
 * 命令不可用时返回 { ok: false }，不抛错，让调用方决定如何展示错误。
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { defaultRunner } from "./tools/lark.js";
import { reloadFolderTree, getFolderTreeRoot, type FolderNode } from "./folderTree.js";

const configPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../config/folder-tree.json",
);

export type RefreshResult =
  | { ok: true; updatedAt: string }
  | { ok: false; reason: string };

const INTER_REQUEST_DELAY_MS = 300; // 飞书 API 限流保护，每次请求间隔

/**
 * 列出 folderToken 下的直接子文件夹，返回 FolderNode[]（children 为空，等待下一层递归填充）。
 *
 * lark-cli 没有"列文件夹子项"的子命令封装（drive files 下只有 copy），
 * 这里直接走通用 api 命令调飞书 open API：GET /open-apis/drive/v1/files?folder_token=...
 * 在代码里按 type==="folder" 筛掉文件，只留子文件夹。
 * exit 非 0 时 defaultRunner 会把 stderr/stdout 拼进错误信息，这里尝试从中解析
 * 结构化错误（限流、认证失败等），给出更精确的提示。
 */
async function listChildren(folderToken: string): Promise<FolderNode[]> {
  const params = JSON.stringify({ folder_token: folderToken, page_size: 200 });
  const args = ["api", "GET", "/open-apis/drive/v1/files", "--params", params, "--as", "user", "--page-all"];
  let stdout: string;
  try {
    stdout = await defaultRunner("lark-cli", args);
  } catch (e) {
    const raw = (e as Error).message;
    // 尝试从错误信息里提取 JSON（defaultRunner 把 stdout/stderr 拼在冒号后面）
    const jsonStart = raw.indexOf("{");
    if (jsonStart !== -1) {
      try {
        const body = JSON.parse(raw.slice(jsonStart)) as {
          error?: { subtype?: string; message?: string; code?: number };
        };
        const sub = body.error?.subtype ?? "";
        const msg = body.error?.message ?? raw;
        if (sub === "rate_limit") throw new Error(`飞书 API 限流 (code ${body.error?.code})，请稍候再试`);
        if (sub === "unauthorized" || sub === "forbidden") throw new Error(`飞书认证失败：${msg}`);
        throw new Error(msg);
      } catch (parseErr) {
        // JSON 解析本身失败，直接重新抛原始错误
        if ((parseErr as Error).message !== raw) throw parseErr;
      }
    }
    // 命令不存在或其他非结构化错误
    throw new Error(`lark-cli 不可用：${raw}`);
  }
  // lark-cli api 的输出就是飞书原始响应：
  //   { code, msg, data: { files: [{ name, token, type, ... }] } }
  // code !== 0 表示业务错误（限流、权限不足等）。
  const parsed = JSON.parse(stdout) as {
    code?: number;
    msg?: string;
    data?: { files?: Array<{ name?: string; token?: string; type?: string }> };
  };
  if (parsed.code !== 0) throw new Error(parsed.msg ?? `飞书 API 错误 code=${parsed.code}`);
  const files = parsed.data?.files ?? [];
  return files
    .filter((f) => f.name && f.token && f.type === "folder")
    .map((f) => ({ name: f.name!, token: f.token!, children: [] }));
}

/**
 * 从给定节点出发，递归构建完整子树。
 * 串行遍历子节点（而非 Promise.all 并发），避免短时间内大量请求触发飞书限流。
 * 每次请求间插入 INTER_REQUEST_DELAY_MS 的延迟。
 */
async function buildTree(node: FolderNode): Promise<FolderNode> {
  const children = await listChildren(node.token);
  const resolved: FolderNode[] = [];
  for (const child of children) {
    await new Promise((r) => setTimeout(r, INTER_REQUEST_DELAY_MS));
    resolved.push(await buildTree(child));
  }
  return { ...node, children: resolved };
}

/**
 * 主入口：从飞书拉取最新文件夹结构，写回 config/folder-tree.json，并热更新内存缓存。
 *
 * 降级策略：
 *   - lark-cli 命令不存在（未安装/版本不支持）→ 返回 { ok: false, reason }，不抛错
 *   - 网络或认证失败 → 同上
 * 调用方（server.ts 的 API 路由）可据此决定是否给前端展示错误信息。
 *
 * 注意：写文件是同步的（writeFileSync），保证写完再调 reloadFolderTree()，
 * 避免极短时间窗口内其他请求读到旧内存 + 新文件的不一致状态。
 */
export async function refreshFolderTree(): Promise<RefreshResult> {
  const root = getFolderTreeRoot();
  let newRoot: FolderNode;
  try {
    // 保留根节点的 name/token，只重建 children
    newRoot = await buildTree({ name: root.name, token: root.token, children: [] });
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }

  const updatedAt = new Date().toISOString().split("T")[0];
  writeFileSync(configPath, JSON.stringify({ updatedAt, root: newRoot }, null, 2) + "\n", "utf-8");
  reloadFolderTree(); // 热更新内存，让后续 renderFolderTree() 立即反映新结构
  return { ok: true, updatedAt };
}
