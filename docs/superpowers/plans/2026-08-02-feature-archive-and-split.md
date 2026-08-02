# Plan — 功能2: 自动归档 + 功能3: 命题拆分

## 背景

当前两个缺口：
1. `larkCreateDoc` 不传 `--parent-token`，所有新文档落在飞书根目录，用户要手动挪
2. `question-analysis.md` 不判断命题粒度，过大的命题会生成一篇臃肿的文档

用户确认的设计决策：
- 文件夹树存静态 JSON（前端留刷新按钮，后续单独做）
- 需要新建文件夹时直接创建，不用在门 1 再次确认
- 拆分后每篇都走完整流水线（包含各自的门1/门2），用户接受双倍交互量

---

## 功能 2：自动归档

### 数据层：`config/folder-tree.json`

存储格式（树形，保留层级关系以便渲染给 agent）：

```json
{
  "updatedAt": "2026-08-02",
  "root": {
    "name": "技术知识库",
    "token": "PxeCf2XCDlnvpcd0VZXcE4M1nsh",
    "children": [
      {
        "name": "前端工程", "token": "OYlnfWqcul2zuQdTuEkct6amnjg",
        "children": [
          { "name": "框架与渲染", "token": "OsCrfa3aVlc0Eed3v3rchDMpnnd", "children": [] },
          { "name": "工程化",    "token": "Q1DBfxEIAlbH7ZdZiU8cbQGfnJd", "children": [] },
          { "name": "JavaScript","token": "OH3FfIk2Nl6FKedr13HcSqYXn3x", "children": [] },
          { "name": "TypeScript","token": "ErzofjcOJlg2KAdnJjTccZcSnOg", "children": [] },
          { "name": "浏览器原理","token": "Ps5Ufb8DElzM2OdJ4hPc0XFmnuf", "children": [] },
          { "name": "服务端",    "token": "IUGIfFbWGlYLhQdvnEdc7uL0n1f", "children": [] },
          { "name": "UI 与交互", "token": "SkCkfAWcnl9RAUdfK29cPBKRntg", "children": [] },
          { "name": "性能优化",  "token": "BaySfQhkOlGRW5dzSLjcrTX8nnd", "children": [] },
          { "name": "微前端",    "token": "Qukhf6C2NlKOcGdl3nIcdKL0n0c", "children": [] }
        ]
      },
      {
        "name": "数据库", "token": "OnWNfGBwllpQ7md0SWjcuUYtnIe",
        "children": [
          { "name": "InnoDB 引擎",    "token": "BVwDfiqUGlJOwhdzU3Wcllb1nlc", "children": [] },
          { "name": "索引与查询优化", "token": "RilPfYEmDlGZfjdqM0KcNjngnih", "children": [] },
          { "name": "锁与事务",       "token": "HadcfFmwVlGvD1dcRQBcjRqgntf", "children": [] },
          { "name": "表设计",         "token": "QwdYflWRnlxHmZd1NVlc5r7fnZd", "children": [] },
          { "name": "高性能 MySQL",   "token": "P7kMfbY9tlavj0d1IRRcle3PnSK", "children": [] },
          { "name": "数据库系统概念", "token": "BiWUfphGQl1LRxdhCPuceUOCnKg", "children": [] },
          { "name": "SQLite",         "token": "Nq6GfRaQZl0D5cd4mn8cw01Envh", "children": [] },
          { "name": "Redis",          "token": "DSlnfQyE4lAIspdj7zFcCY1jnyh", "children": [] },
          { "name": "实操",           "token": "RTG2f346flzY8sdkVHIci84Qnie", "children": [] }
        ]
      },
      {
        "name": "计算机系统原理", "token": "ZWpefGOAqlsZLedbHDkcm2aknMc",
        "children": [
          {
            "name": "操作系统", "token": "PL1GfLFwXlxeahdrNcJcfYAEnTe",
            "children": [
              { "name": "Linux 系统编程", "token": "GNpRfEujXlJ4DadiJ8YcPJxunEf", "children": [] }
            ]
          },
          { "name": "计算机网络", "token": "RUpxf6lHJlIeNDdp5P3cjEv5n1d", "children": [] },
          { "name": "分布式系统", "token": "B2tBfPmhClCgocdY6GMcwlsLn2e", "children": [] },
          { "name": "云服务器",   "token": "XRoJffPeNlO0w3d3cm9cT5Exnqd", "children": [] }
        ]
      },
      { "name": "Go 语言",        "token": "BRXpfcZWflh2j8drIGSciRHMnUh", "children": [] },
      {
        "name": "AI 与效率工具", "token": "AvhbfTQWSlSc03dTupXcGoEPn4c",
        "children": [
          { "name": "大模型原理", "token": "WeysfcTa3lYVd7diXqEcR67Nn4g", "children": [] },
          { "name": "工具与效率", "token": "CR6RfUcWelenOXd7mEpcxAKCngh", "children": [] }
        ]
      },
      { "name": "架构与系统设计", "token": "Jk06fXUc6lJ5Z8djeVyc6jdSn1f", "children": [] },
      { "name": "算法与数据结构", "token": "Nvo9f5hEGljZ0Vd40k9cm0iNntg", "children": [] }
    ]
  }
}
```

### 刷新脚本：`scripts/refresh-folder-tree.ts`（新文件，前端"刷新"按钮调用）

用 `ft-lark-cli drive files list` 递归拉取 `技术知识库` 子树，重写 `config/folder-tree.json`。
现阶段不实现自动调用，仅作为手动命令：`npx tsx scripts/refresh-folder-tree.ts`。

---

### 工具函数：`src/folderTree.ts`（新文件）

```typescript
import tree from "../config/folder-tree.json" assert { type: "json" };

interface FolderNode { name: string; token: string; children: FolderNode[] }

/** 将树形结构渲染为缩进文本，注入 agent system prompt */
export function renderFolderTree(node: FolderNode = tree.root, depth = 0): string {
  const indent = "  ".repeat(depth);
  const self = `${indent}${node.name} [${node.token}]`;
  const kids = node.children.map(c => renderFolderTree(c, depth + 1)).join("\n");
  return kids ? `${self}\n${kids}` : self;
}

/** 按 token 查找节点（用于验证 agent 输出的 token 合法） */
export function findByToken(token: string, node: FolderNode = tree.root): FolderNode | null {
  if (node.token === token) return node;
  for (const child of node.children) {
    const found = findByToken(token, child);
    if (found) return found;
  }
  return null;
}
```

### `prompts/question-analysis.md` 输出格式扩展

在现有三个 section 后追加两个必填 section：

```
## 文档标题
<简洁规范的中文/英文标题，符合命名规范（官方大小写，无"专题/专项"后缀）>

## 归档位置
<文件夹路径> [token: <token>]
```

若现有文件夹均不合适，输出：
```
## 归档位置
新建文件夹：<父路径>/<新文件夹名> [parent_token: <父文件夹token>]
```

system prompt 末尾注入文件夹树（`renderFolderTree()` 生成的文本），格式：
```
---
【可用文件夹目录】
技术知识库 [PxeC...]
  前端工程 [OYln...]
    框架与渲染 [OsCr...]
    ...
```

### `orchestrator.ts` 改动

**新增类型 `PlacementInfo`**：
```typescript
export type PlacementInfo =
  | { type: "existing"; folderToken: string; title: string }
  | { type: "new"; parentToken: string; folderName: string; title: string };
```

**新增解析函数 `parsePlacement(output: string): PlacementInfo`**：
- 匹配 `## 归档位置` 下的文本
- 正则提取 token；若含"新建文件夹"则解析 parent_token + folderName
- fallback：token 无法识别时用根目录 `技术知识库` token

**`publish` 签名变更**：
```typescript
// PipelineDeps 中
publish: (markdown: string, placement: PlacementInfo) => Promise<string>;
```

`runPipeline` 里，在门 1 通过后立即调用 `parsePlacement(outline1)` 得到 `placement`，发布时传给 `publish`。

### `src/tools/lark.ts` 改动

`buildCreateDocArgs` 接受可选 `parentToken`：
```typescript
export function buildCreateDocArgs(
  format: DocFormat = "markdown",
  parentToken?: string,
): string[] {
  const args = ["docs", "+create", "--doc-format", format, "--content", "-", "--as", "user"];
  if (parentToken) args.push("--parent-token", parentToken);
  return args;
}
```

`larkCreateDoc` 透传 `parentToken` 给 `buildCreateDocArgs`。

### `src/cli.ts` 改动

`publish` 闭包内增加两步：
1. 若 `placement.type === "new"`：先调 `ft-lark-cli drive +create-folder` 创建文件夹，拿到新 token
2. 用解析到的 `folderToken` 调 `larkCreateDoc(markdown, "markdown", folderToken)`

---

## 功能 3：命题拆分

### `prompts/question-analysis.md` 追加判断规则

在"要求"节末尾加：

```
## 拆分判断

若命题满足以下任一条件，输出 `## 拆分建议` section（否则省略此 section）：
- 一级话题超过 5 个，且各话题之间相对独立、展开深度相当
- 任意一个一级话题本身就足以撑起一篇完整文档

## 拆分建议
> 命题偏大，建议拆成 N 篇：
- 文档 A「<标题A>」→ 归档：<路径A> [token: <tokenA>]
- 文档 B「<标题B>」→ 归档：<路径B> [token: <tokenB>]
```

**不拆的情况不输出此 section**，以保持现有流程不变。

### `orchestrator.ts` 改动

**新增解析函数 `parseSplitSuggestion(output: string)`**：
```typescript
export interface SplitDoc {
  title: string;
  placement: PlacementInfo;
}
// 返回 null 表示无拆分建议
export function parseSplitSuggestion(output: string): SplitDoc[] | null
```

**`runPipeline` 拆分流程**（插入门 1 之后）：

```
questionAnalysis 输出 outline1
↓
parseSplitSuggestion(outline1)
↓ 有建议
门：展示拆分建议，用户三选一
  A. 确认拆分   → 返回特殊结果 { split: true, topics: SplitDoc[] }
  B. 不拆，继续 → 继续正常流水线（parsePlacement 取第一篇归档位置）
  C. 输入意见   → 将意见追加 user，重跑 questionAnalysis（现有门迭代逻辑）
↓ 无建议
正常流水线
```

**`PipelineResult` 类型扩展**：
```typescript
export type PipelineResult =
  | { kind: "single"; url: string; markdown: string; skeleton: string; feedbacks: GateFeedback[] }
  | { kind: "split";  topics: Array<{ title: string; placement: PlacementInfo }> };
```

当用户选"确认拆分"时，`runPipeline` 立即返回 `{ kind: "split", topics }` 而不继续执行后续步骤。

### `src/cli.ts` 改动

检查 `result.kind`：
```typescript
if (result.kind === "split") {
  console.error(`\n命题已拆分为 ${result.topics.length} 篇，逐篇生成：`);
  for (const topic of result.topics) {
    console.error(`\n▶ 开始生成：${topic.title}`);
    const sub = await runPipeline(topic.title, { ...deps, /* 注入 placement */ });
    console.log(`✅ ${topic.title}:`, sub.url);
  }
}
```

每篇子流水线走完整的门 1 + 门 2 + 生成流程，以 `topic.title` 作为 `userInput`。
归档位置通过闭包从 `topic.placement` 注入，覆盖 agent 在子流水线中可能重新选择的位置（保持拆分时确认的归档不变）。

---

## 改动文件汇总

| 文件 | 类型 | 说明 |
|------|------|------|
| `config/folder-tree.json` | 新建 | 飞书文件夹树静态配置 |
| `src/folderTree.ts` | 新建 | 树渲染 + token 查找工具函数 |
| `scripts/refresh-folder-tree.ts` | 新建 | 手动刷新文件夹树脚本 |
| `prompts/question-analysis.md` | 修改 | 追加归档/标题/拆分输出格式 + 文件夹树注入点 |
| `src/orchestrator.ts` | 修改 | PlacementInfo 类型、parsePlacement、parseSplitSuggestion、拆分门逻辑、PipelineResult 扩展、publish 签名变更 |
| `src/tools/lark.ts` | 修改 | buildCreateDocArgs 支持 parentToken |
| `src/cli.ts` | 修改 | publish 闭包处理归档、larkCreateFolder 调用、split result 处理 |

---

## 实施顺序

1. **数据层**：创建 `config/folder-tree.json` + `src/folderTree.ts`（无副作用，先跑通单测）
2. **功能 2**：改 `question-analysis.md` → `orchestrator.ts` → `lark.ts` → `cli.ts`，端到端验证归档正确
3. **功能 3**：在功能 2 基础上加拆分逻辑，最后验证拆分流程

每步完成后运行 `npm test` + `npm run typecheck`。

---

## 完成标准

- [ ] `config/folder-tree.json` 存在，包含全部文件夹 token
- [ ] `npm start -- "pnpm 原理"` 后文档自动出现在 `前端工程/工程化`，不落根目录
- [ ] 需要新建文件夹时自动创建后再写入文档
- [ ] 输入偏大命题（如"前端工程化全景"）门1出现拆分建议，确认后顺序发布两篇
- [ ] 不拆分时流程与现在完全一致（向后兼容）
- [ ] `npm test`（85+新增测试）全绿，`npm run typecheck` 通过
