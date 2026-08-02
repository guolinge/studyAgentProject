/**
 * folderTree.ts — 飞书文件夹树工具函数
 *
 * 从 config/folder-tree.json 读取静态文件夹树，提供：
 *   - renderFolderTree：渲染为缩进文本，注入 agent system prompt（替换 {{FOLDER_TREE}} 占位符）
 *   - findByToken：按 token 查找节点，验证 agent 输出中的 token 是否合法
 *   - reloadFolderTree：热更新内存缓存（refresh-folder-tree 脚本写完 JSON 后调用）
 *
 * 设计要点：
 *   - 使用可重置的模块级变量 _root，而非不可变常量。
 *     这样 server.ts 在刷新 JSON 后调用 reloadFolderTree()，
 *     后续所有 renderFolderTree / findByToken 调用都能立即看到新数据，无需重启进程。
 *   - 用 fs.readFileSync + JSON.parse 替换 createRequire：
 *     require() 有模块缓存，第二次 require 同路径文件会返回缓存结果，无法感知磁盘变化。
 *     readFileSync 每次都读磁盘，配合 reloadFolderTree() 可实现热更新。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export interface FolderNode {
  name: string;
  token: string;
  children: FolderNode[];
}

interface FolderTreeFile {
  updatedAt: string;
  root: FolderNode;
}

const configPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../config/folder-tree.json");

function loadTree(): FolderTreeFile {
  return JSON.parse(readFileSync(configPath, "utf-8")) as FolderTreeFile;
}

let _root: FolderNode = loadTree().root;

/** refresh 后调用，使内存状态与磁盘文件同步 */
export function reloadFolderTree(): void {
  _root = loadTree().root;
}

/** 当前根节点（getter，始终反映最新加载的状态） */
export function getFolderTreeRoot(): FolderNode {
  return _root;
}

/**
 * 兼容旧引用的常量导出（orchestrator.ts 等地方用到）。
 * 注意：这是模块初始化时的快照，不会随 reloadFolderTree() 更新。
 * 仅用于"拿根节点 token 作 fallback"这类不需要最新数据的场景。
 * 需要最新数据时请改用 getFolderTreeRoot()。
 */
export const folderTreeRoot: FolderNode = _root;

/** 将树形结构渲染为缩进文本，注入 agent system prompt */
export function renderFolderTree(node: FolderNode = getFolderTreeRoot(), depth = 0): string {
  const indent = "  ".repeat(depth);
  const line = `${indent}${node.name} [${node.token}]`;
  if (node.children.length === 0) return line;
  const kids = node.children.map((c) => renderFolderTree(c, depth + 1)).join("\n");
  return `${line}\n${kids}`;
}

/** 按 token 查找节点，找不到返回 null */
export function findByToken(token: string, node: FolderNode = getFolderTreeRoot()): FolderNode | null {
  if (node.token === token) return node;
  for (const child of node.children) {
    const found = findByToken(token, child);
    if (found) return found;
  }
  return null;
}
