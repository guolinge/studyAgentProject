/**
 * folderTree.ts — 飞书文件夹树工具函数
 *
 * 从 config/folder-tree.json 读取静态文件夹树，提供：
 *   - renderFolderTree：渲染为缩进文本，注入 agent system prompt
 *   - findByToken：按 token 查找节点，验证 agent 输出合法性
 */

import { createRequire } from "node:module";
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

/** 加载 config/folder-tree.json（相对于项目根目录） */
function loadTree(): FolderTreeFile {
  const require = createRequire(import.meta.url);
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const configPath = path.resolve(dir, "../config/folder-tree.json");
  return require(configPath) as FolderTreeFile;
}

const _tree = loadTree();

export const folderTreeRoot: FolderNode = _tree.root;

/** 将树形结构渲染为缩进文本，注入 agent system prompt */
export function renderFolderTree(node: FolderNode = folderTreeRoot, depth = 0): string {
  const indent = "  ".repeat(depth);
  const line = `${indent}${node.name} [${node.token}]`;
  if (node.children.length === 0) return line;
  const kids = node.children.map((c) => renderFolderTree(c, depth + 1)).join("\n");
  return `${line}\n${kids}`;
}

/** 按 token 查找节点，找不到返回 null */
export function findByToken(token: string, node: FolderNode = folderTreeRoot): FolderNode | null {
  if (node.token === token) return node;
  for (const child of node.children) {
    const found = findByToken(token, child);
    if (found) return found;
  }
  return null;
}
