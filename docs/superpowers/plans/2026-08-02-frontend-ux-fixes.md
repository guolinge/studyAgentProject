# 前端体验修复：问题 7 → 3 → 2 → 8 → 6

## 背景

用户体验一遍后反馈了 8 个问题，本计划按优先级修复其中 5 个（不涉及布局重构的部分）。

## 问题总览

| # | 问题 | 涉及层 |
|---|------|--------|
| 7 | 飞书链接要等画图完才出现，用户等很久 | server.ts + frontend |
| 3 | ✓ 勾号出现在环节开始时，误导用户以为已完成 | server.ts + frontend |
| 2 | gate 按钮无论有没有输入都显示"通过"，语义不清 | frontend only |
| 8 | SVG 作图失败没有错误提示 | diagrams.ts + server.ts + frontend |
| 6 | 内容审核反馈内容不可见 | orchestrator.ts + server.ts + frontend |

---

## 新增 SSE 事件类型

在 `server.ts` 和 `web/lib/types.ts` 里同步新增：

```typescript
{ type: "step_start";      role: AgentRole; label: string }         // 环节开始（旋转环）
{ type: "step_error";      label: string;   message: string }       // 单步失败（红色）
{ type: "doc_created";     url: string;     folderName: string }     // 飞书文档已建好（含链接）
{ type: "review_feedback"; content: string }                        // 审核意见内容
```

原有 `{ type: "progress" }` 语义改为"环节完成（✓）"。

---

## 各问题实现细节

### 问题 7：飞书链接提前出现

**`src/server.ts` — `buildDeps.publish`：**
1. 创建文档获得 URL
2. 从 `placement` 取文件夹名
3. 立刻推 `doc_created` 事件
4. **不 await** `patchDiagrams`，fire-and-forget（diagrams 在后台跑，完成各自推 `progress`，失败推 `step_error`）
5. 返回 URL

**`web/app/page.tsx`：**
- state 增加 `docUrl: string | null`、`docFolder: string | null`
- 收到 `doc_created` → dispatch → 渲染"飞书文档"卡片（占位 → 链接）
- `DoneEvent` 不再携带 URL（已由 `doc_created` 提前出现），但保留 `done` 事件作为流水线结束信号

### 问题 3：环节状态区分

**`src/server.ts` — `buildDeps.runRole`：**
- 执行前推 `step_start`
- 执行后推 `progress`（保持原有含义=已完成）

**`web/components/ProgressLog.tsx`：**
- 从 events 数组推导 stepState: `Map<label, "running" | "done">`
- `step_start` → 插入 running 行（旋转环 `◌`）
- `progress` → 对应 label 改为 done（✓）
- 渲染时用 stepState 驱动，同一 label 只渲染一行

### 问题 2：按钮随输入变化

**`web/components/ProgressLog.tsx` — `GateCard`：**
- 增加 `const [inputVal, setInputVal] = useState("")`
- textarea `onChange` 更新 `inputVal`
- 按钮文案：`inputVal.trim() ? "提交意见 →" : "通过 ↵"`
- 按钮颜色：有内容 → `bg-amber-500 hover:bg-amber-400`；空 → `bg-indigo-600 hover:bg-indigo-500`

### 问题 8：SVG 失败显示错误

**`src/diagrams.ts` — `PatchDeps`：**
- 新增 `onError?: (instruction: string, reason: string) => void`
- `patchDiagrams`：`svg === null` 时调用 `deps.onError?.(spec.instruction, "SVG 校验超出重试次数")`

**`src/server.ts` — `buildDeps.publish`：**
- 传 `onError` 给 `patchDiagrams`，调用时 `pushEvent(runId, { type: "step_error", label: "SVG 作图", message: ... })`

**`web/components/ProgressLog.tsx`：**
- 新增 `step_error` 渲染：红色 `✗` 行，显示 label + message

### 问题 6：审核反馈可见

**`src/orchestrator.ts` — `PipelineDeps`：**
- 新增 `onReviewFeedback?: (feedback: string) => void`
- 审核循环 FAIL 分支：`deps.onReviewFeedback?.(verdict)`

**`src/server.ts` — `buildDeps`：**
- 传 `onReviewFeedback: (fb) => pushEvent(runId, { type: "review_feedback", content: fb })`

**`web/components/ProgressLog.tsx`：**
- 新增 `review_feedback` 渲染：橙色卡片，标题"审核意见"，展示 content

---

## 文件变更清单

| 文件 | 变动 |
|------|------|
| `src/server.ts` | 新增事件类型；runRole 加 step_start；publish 改 fire-and-forget 并推 doc_created；传 onError/onReviewFeedback |
| `src/orchestrator.ts` | PipelineDeps 加 onReviewFeedback；审核循环调用 |
| `src/diagrams.ts` | PatchDeps 加 onError；patchDiagrams 失败时调用 |
| `web/lib/types.ts` | 同步新增 4 个事件类型 |
| `web/app/page.tsx` | 增加 docUrl/docFolder state；处理 doc_created 事件 |
| `web/components/ProgressLog.tsx` | step state machine；GateCard 按钮逻辑；新事件类型渲染 |

---

## 完成标准

- [ ] 文字写入飞书后立刻显示链接，画图继续后台跑
- [ ] 每个环节开始时显示旋转环，完成后变 ✓
- [ ] gate 有内容时按钮变橙色"提交意见"，空时蓝色"通过"
- [ ] SVG 失败时日志里出现红色错误行
- [ ] 内容审核 FAIL 时展示橙色审核意见卡片
- [ ] `npm test && npm run typecheck` 全绿
