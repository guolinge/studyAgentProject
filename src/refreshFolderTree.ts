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

/**
 * 列出 folderToken 下的直接子文件夹，返回 FolderNode[]（children 为空，等待下一层递归填充）。
 *
 * 只抓取 type=folder 的条目，跳过文档、快捷方式等其他类型。
 * JSON 解析失败或 ok=false 时直接抛错，由上层 buildTree 捕获并决定是否降级。
 */
async function listChildren(folderToken: string): Promise<FolderNode[]> {
  // lark-cli drive files list 没有 --type 过滤参数，在代码里按 type===folder 筛选
  const args = ["drive", "files", "list", "--folder-token", folderToken, "--as", "user"];
  const stdout = await defaultRunner("lark-cli", args);
  const parsed = JSON.parse(stdout) as {
    ok?: boolean;
    data?: { files?: Array<{ name?: string; token?: string; type?: string }> };
    error?: { message?: string };
  };
  if (!parsed.ok) throw new Error(parsed.error?.message ?? "unknown");
  return (parsed.data?.files ?? [])
    .filter((f) => f.name && f.token && f.type === "folder")
    .map((f) => ({ name: f.name!, token: f.token!, children: [] }));
}

/**
 * 从给定节点出发，递归构建完整子树。
 * 使用 Promise.all 并发拉取同级兄弟节点的子项，减少总 RTT。
 * 飞书文件夹层级一般不超过 3 层，不会有栈溢出风险。
 */
async function buildTree(node: FolderNode): Promise<FolderNode> {
  const children = await listChildren(node.token);
  const resolved = await Promise.all(children.map((c) => buildTree(c)));
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
    const msg = (e as Error).message;
    if (msg.includes("unknown command") || msg.includes("exit") || msg.includes("not found")) {
      return { ok: false, reason: `lark-cli drive files list 不可用：${msg}` };
    }
    return { ok: false, reason: msg };
  }

  const updatedAt = new Date().toISOString().split("T")[0];
  writeFileSync(configPath, JSON.stringify({ updatedAt, root: newRoot }, null, 2) + "\n", "utf-8");
  reloadFolderTree(); // 热更新内存，让后续 renderFolderTree() 立即反映新结构
  return { ok: true, updatedAt };
}
