# Plan — Next.js 前端 + refresh-folder-tree 小按钮

## Context

现有项目是纯 CLI 工具（`npm start -- "主题"`），通过 readline 交互门（gate）。目标是加一个 Web 界面：浏览器里输入主题、看实时进度、响应门，拿到飞书文档链接。refresh-folder-tree 只是一个附带的小按钮（更新 config/folder-tree.json）。

## 架构决策

**`src/server.ts`（Hono）作后端 + `web/`（Next.js 15）作纯前端，两者通过 HTTP 通信。**

不用 Next.js API Routes 直接 import `../src/` 的原因：
1. `src/` 的 ESM `.js` 扩展名在 Next.js webpack 里需要复杂的 `extensionAlias` 配置
2. 门机制需要在两次请求之间持有 Promise resolver（模块级 Map）；Next.js 多 worker 下状态会丢失

Hono 用 `node --import tsx` 启动，和 `cli.ts` 完全相同的运行时，无需额外配置。

## Gate 机制（核心设计）

Pipeline 在 `await deps.gate(title, content)` 处阻塞。Web 环境下替换为：

```
POST /api/run { topic }        → 后台启动 runPipeline，返回 { runId }
GET  /api/run/:id/events       → SSE 长连接推送进度事件
pipeline 走到 gate()            → 推送 { type:"gate", title, content }，存 resolver 等待
用户在浏览器填写/回车          → POST /api/run/:id/gate { reply }
服务端调用 resolver(reply)     → pipeline 继续
```

**RunState（模块级 Map，单进程安全）：**
```typescript
interface RunState {
  eventQueue: PipelineEvent[];
  subscribers: Set<(e: PipelineEvent) => void>;
  gateResolver: ((reply: string) => void) | null;
}
const runs = new Map<string, RunState>();
```

**SSE 事件类型：**
- `{ type:"progress", role, label }` — agent 开始运行
- `{ type:"gate", title, content }` — gate 触发，前端弹窗
- `{ type:"gate_closed" }` — gate 通过，继续
- `{ type:"done", url, kind }` — 完成
- `{ type:"error", message }` — 出错

## 文件清单

### 后端（新增）
- `src/server.ts` — Hono HTTP 服务器，端口 3001（可 `PORT=` 覆盖）
- `src/refreshFolderTree.ts` — refresh 核心逻辑，失败返回 `{ok:false}` 不抛错

### 后端（修改）
- `src/folderTree.ts` — 新增 `reloadFolderTree()` 导出，对外签名不变
- 根 `package.json` — 新增 `"serve"` script

### 前端（全新 `web/` 目录）
- `web/package.json` — Next.js 15 + React 19 + Tailwind CSS 4
- `web/app/layout.tsx` + `web/app/page.tsx` — 主页面
- `web/components/GateModal.tsx` — 门卡片（内联，非弹窗）
- `web/components/ProgressLog.tsx` — 实时进度列表
- `web/lib/api.ts` + `web/lib/types.ts` — HTTP 客户端 + 类型定义

## 输入框设计

Textarea（非单行 input），支持三种场景：
1. 短问题（`pnpm 原理`）
2. 问题 + AI 回答（整理/拓展）
3. 链接（网页/公众号，待后续实现抓取能力）

## 验证步骤

1. `npm run serve`（端口 3001）
2. `cd web && npm run dev`（端口 3000，`NEXT_PUBLIC_API_URL=http://localhost:3001`）
3. 浏览器走完整流程：输入 → 进度日志 → 门卡片 → 飞书 URL
4. `npm test` + `npm run typecheck` + `cd web && npm run build` 全绿
