# 门2「复制大纲」offload + prompt 修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 门2 新增「复制大纲」分支——打包「内容生成+作图」全部 prompt 给 AI 中台 offload 长文生成，本系统建空白飞书文档+入索引；顺带修体量纪律缺失与 drawing-rules 冗余。

**Architecture:** 保留门1/研究/dedup/拆分不变。门2 从通用 `iterateWithGate` 改为自定义循环，识别哨兵 `__COPY_OUTLINE__`：命中则组装 bundle（纯函数）、经 `publishBlank` 建空文档、入索引、返回新结果类型 `outline_copied`；否则走原生成路径。bundle 随门2 gate 事件带给前端，前端按钮写剪贴板。

**Tech Stack:** TypeScript ESM + Node 20 + Hono + Next.js/React + vitest。依赖注入。

**参考 spec:** `docs/superpowers/specs/2026-08-06-copy-outline-offload-design.md`

---

## 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `prompts/drawing-rules-ascii.md` | 字符画图硬约束 | 精简到只留 A |
| `prompts/content-generation.md` | 内容生成方法论 | 加「体量纪律」节 |
| `prompts/content-review.md` | 审核检查清单 | 收紧第 5 条体量检查 |
| `src/outlineBundle.ts` | bundle 组装纯函数（新） | 创建 |
| `src/io.ts` | Asker 类型 | 加可选 bundle 参数 |
| `src/orchestrator.ts` | 门2 分支 + 信号 + 结果类型 | 改造 |
| `src/server.ts` | GateEvent+gate 转发 bundle、publishBlank、收口 | 改造 |
| `src/cli.ts` | publishBlank、处理 outline_copied | 改造 |
| `web/lib/types.ts` | GateEvent 加 bundle | 改造 |
| `web/components/GateViewer.tsx` | 复制大纲按钮 | 改造 |
| `tests/outlineBundle.test.ts` | bundle 单测（新） | 创建 |
| `tests/orchestrator.test.ts` | offload 分支用例 | 补用例 |

## 类型契约（贯穿全计划）

- 哨兵常量 `COPY_OUTLINE_SIGNAL = "__COPY_OUTLINE__"`（`src/orchestrator.ts` 导出；前端 `web/lib/types.ts` 同值定义一份）
- `Asker = (title: string, content: string, bundle?: string) => Promise<string>`（io.ts）
- `PipelineDeps.publishBlank?: (title: string, placement: PlacementInfo) => Promise<string>`（**可选**，offload 分支用；未注入则抛错）
- `PipelineResult` 增 `| { kind: "outline_copied"; url: string; bundle: string; feedbacks: GateFeedback[] }`
- `buildOutlineBundle(parts: BundleParts): string`（src/outlineBundle.ts）
- web `GateEvent` 增 `bundle?: string`

---

## Task 1: prompt 修复（#2 精简画图规范 + #3 体量纪律）

**Files:**
- Modify: `prompts/drawing-rules-ascii.md`（精简到只留 A）
- Modify: `prompts/content-generation.md`（加「体量纪律」节）
- Modify: `prompts/content-review.md`（收紧第 5 条）

纯 prompt 文件，无单测。**分次 Edit，勿一次写超大块。**

- [ ] **Step 1: 精简 drawing-rules-ascii.md**

用下面内容**整体替换** `prompts/drawing-rules-ascii.md`（删掉原 B~G，只留硬约束）：

```markdown
# 字符画图规范（ASCII，硬约束）

用纯文本字符画图，放进围栏代码块（等宽渲染）。只需遵守下面的硬约束——违反会导致渲染乱码或对齐崩坏。

## 字符集（分两类，严格区分）

- **结构/连线字符**：框线用 `+ - |`，箭头用 `> < ^ v`，斜线 `/ \` 少用。**只能用这些**画框和连线。
- **文字标签**：框内/线旁的文字可用中文、英文、数字、标准标点。中文/全角字符在等宽字体下按 **2 列宽**计算，参与列宽核算。

## 禁用字符（一律不准出现）

Unicode 制表符/装饰符会在等宽环境里错位或显示成方块，禁止使用：
`┌ ┐ └ ┘ ─ │ ├ ┤ ┬ ┴ ┼ ╔ ╗ ╚ ╝ ═ ║ ╭ ╮ ╰ ╯ ▶ ▼ ◀ ▲ ● ○ ◆ ◇`

## 宽度

每行显示列宽 ≤ 100 列（中文按 2 列计），优先 ≤ 80。

## 产出

只输出图本身（放进围栏代码块）。中文标签要按 2 列宽把框宽算准，保证上下边框与内容行对齐。
```

- [ ] **Step 2: content-generation.md 加「体量纪律」**

在 `prompts/content-generation.md` 的「## 推导执行法」一节之后、「## 关于联网搜索结果」之前，插入：

```markdown
## 体量纪律

骨架里每个小节都标了「体量」估算（如"约 380 字"、"一屏代码"）。这是使用者对篇幅的预期，**必须当作硬性目标**：

- 逐节对齐体量：标"约 N 字"的节，正文该节要写到接近 N 字，不能明显偏短。
- 篇幅不足时，靠**展开推导链、补充例子、增加边界/取舍讨论、加类比**来写足，而不是压缩或敷衍。
- 反过来也别为凑字数灌水；体量小的节保持精炼。
- 若某节内容确实撑不到估算体量，说明骨架估大了——按内容实际需要写，但要在该节尽力做透（多一层 why、多一个反例），而非草草收尾。
```

- [ ] **Step 3: content-review.md 收紧第 5 条**

`prompts/content-review.md` 检查清单第 5 条现为：
`5. **体量**:各节篇幅是否大致落在骨架估算范围内?没有某节严重超长或过短?`
替换为：

```markdown
5. **体量**:逐节对照骨架的体量估算,有没有哪节篇幅**明显低于**估算(如标"约 300 字"实际只有一两句)?只要有一节明显偏短就判 FAIL,并指明是哪节、估算多少、实际偏短,让生成 agent 补足。
```

- [ ] **Step 4: 跑一次全量测试确保没弄坏 prompt 加载**

Run: `npx vitest run`
Expected: 全绿（prompt 是文本，改动不影响现有测试；若有 prompt 存在性断言应仍通过）

- [ ] **Step 5: 提交**

```bash
git add prompts/drawing-rules-ascii.md prompts/content-generation.md prompts/content-review.md
git commit -m "fix: 精简字符画图规范(#2) + 补体量纪律并收紧审核(#3)"
```

---

## Task 2: `src/outlineBundle.ts` — bundle 组装纯函数

**Files:**
- Create: `src/outlineBundle.ts`
- Test: `tests/outlineBundle.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

创建 `tests/outlineBundle.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { buildOutlineBundle } from "../src/outlineBundle.js";

const parts = {
  question: "讲讲 pnpm 的硬链接原理",
  research: "",
  skeleton: "# pnpm\n## 1. 问题\n### 1.1 幽灵依赖\n- 体量: 中, 约 200 字",
  generation: "【内容生成方法论正文】",
  styleRules: "【风格规则正文】",
  drawingRules: "【字符画图规范正文】",
};

describe("buildOutlineBundle", () => {
  it("按段序拼接，含所有必要段", () => {
    const b = buildOutlineBundle(parts);
    expect(b).toContain("资深技术作者");           // framing
    expect(b).toContain("讲讲 pnpm 的硬链接原理");   // 问题
    expect(b).toContain("幽灵依赖");                 // 骨架
    expect(b).toContain("【内容生成方法论正文】");
    expect(b).toContain("【风格规则正文】");
    expect(b).toContain("【字符画图规范正文】");
    // 覆盖指令出现在生成方法论之后、风格规则之前
    const iGen = b.indexOf("【内容生成方法论正文】");
    const iOverride = b.indexOf("直接用字符图画进围栏代码块");
    const iStyle = b.indexOf("【风格规则正文】");
    expect(iGen).toBeLessThan(iOverride);
    expect(iOverride).toBeLessThan(iStyle);
  });

  it("research 为空时跳过研究段", () => {
    const b = buildOutlineBundle(parts);
    expect(b).not.toContain("联网研究资料");
  });

  it("research 非空时插入研究段，且在骨架之前", () => {
    const b = buildOutlineBundle({ ...parts, research: "【最新事实: pnpm v9】" });
    expect(b).toContain("联网研究资料");
    expect(b).toContain("【最新事实: pnpm v9】");
    expect(b.indexOf("【最新事实: pnpm v9】")).toBeLessThan(b.indexOf("幽灵依赖"));
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/outlineBundle.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现**

创建 `src/outlineBundle.ts`：

```ts
/**
 * outlineBundle.ts — 门2「复制大纲」的剪贴板 bundle 组装
 *
 * 把本系统「内容生成 + 作图」的全部指令连同骨架拼成一段自包含文本，
 * 供使用者粘贴到外部 AI 中台一次性生成带图完整文档。纯函数，可单测。
 */

export interface BundleParts {
  question: string;      // 原始问题
  research: string;      // 联网研究 memo，可为空
  skeleton: string;      // 门2 确认/展示的骨架
  generation: string;    // content-generation.md 全文
  styleRules: string;    // style-rules.md 全文
  drawingRules: string;  // 精简 drawing-rules-ascii.md 全文
}

const SEP = (name: string) => `\n\n## ===== ${name} =====\n\n`;

// 覆盖 content-generation.md 里"写【配图指令】占位交给后续 agent"的指令：
// 本任务没有后续画图环节，中台需就地画图。
const DRAW_OVERRIDE =
  "配图处理（覆盖上文关于配图的说明）：本任务没有后续画图环节。" +
  "遇到需要图的地方，请**直接用字符图画进围栏代码块**（规范见下一段），" +
  "不要输出 `【配图指令:...】` 占位符。";

export function buildOutlineBundle(p: BundleParts): string {
  const framing =
    "请扮演资深技术作者，读者是一名前端工程师（懂后端、目标成为架构师）。" +
    "请严格按下面的【骨架】【方法论】【风格规则】【字符画图规范】，" +
    "输出一篇结构清晰、有推导、有类比、有代码与字符图的完整 Markdown 讲解文档。";

  let out = framing;
  out += SEP("原始问题") + p.question;
  if (p.research.trim()) out += SEP("联网研究资料（最新事实优先采信）") + p.research;
  out += SEP("已确认的骨架（含体量，严格按体量写足）") + p.skeleton;
  out += SEP("内容生成方法论") + p.generation;
  out += SEP("配图处理（覆盖指令）") + DRAW_OVERRIDE;
  out += SEP("回答风格规则") + p.styleRules;
  out += SEP("字符画图规范") + p.drawingRules;
  return out;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/outlineBundle.test.ts`
Expected: PASS（3 用例）

- [ ] **Step 5: typecheck + 提交**

```bash
npx tsc --noEmit
git add src/outlineBundle.ts tests/outlineBundle.test.ts
git commit -m "feat: 加 buildOutlineBundle 组装 offload 剪贴板 bundle"
```

---

## Task 3: orchestrator 门2 offload 分支

**Files:**
- Modify: `src/io.ts`（Asker 加可选 bundle）
- Modify: `src/orchestrator.ts`（信号常量、publishBlank dep、结果类型、门2 自定义循环）
- Test: `tests/orchestrator.test.ts`

### 3a. io.ts 扩展 Asker

- [ ] **Step 1: Asker 加可选 bundle 参数**

`src/io.ts` 的 `Asker` 类型改为：

```ts
export type Asker = (title: string, content: string, bundle?: string) => Promise<string>;
```

`createReadlineAsker` 的实现体不用改（多一个被忽略的可选参数不影响 readline 逻辑）。若其函数签名显式写了 `(title, content)`，保持即可，TS 结构类型兼容。

### 3b. orchestrator 改造

- [ ] **Step 2: import + 常量 + 类型**

`src/orchestrator.ts` 顶部 import 追加：

```ts
import { buildOutlineBundle } from "./outlineBundle.js";
```

在文件靠上位置（PlacementInfo 定义附近）导出信号常量：

```ts
/** 门2「复制大纲」哨兵：gate 返回此值表示走 offload 分支 */
export const COPY_OUTLINE_SIGNAL = "__COPY_OUTLINE__";
```

`PipelineDeps` 接口追加（放在 updateIndex 附近，保持可选风格）：

```ts
  /** 门2「复制大纲」分支：建仅含标题的空白文档，返回 URL */
  publishBlank?: (title: string, placement: PlacementInfo) => Promise<string>;
```

`PipelineResult` 联合类型追加一支：

```ts
  | { kind: "outline_copied"; url: string; bundle: string; feedbacks: GateFeedback[] }
```

- [ ] **Step 3: 门2 从 iterateWithGate 改为自定义循环**

把 `runPipeline` 里现有的门2 段（`const skeleton = await iterateWithGate(deps, "contentOrganization", "门2 · 确认骨架", orgSystem, orgUser, collect);`）替换为：

```ts
  // ② 内容组织 →门2(重)：确认三级骨架；门2 支持第三分支「复制大纲」offload
  const orgSystem = buildSystem(deps.loadPrompt, "content-organization", true);
  const orgUser = withSearch(`${userInput}\n\n【已确认的范围与意图】\n${outline1}`);
  let skeleton = await deps.runRole("contentOrganization", { system: orgSystem, user: orgUser });
  for (;;) {
    const bundle = buildOutlineBundle({
      question: userInput,
      research: researchMemo,
      skeleton,
      generation: deps.loadPrompt("content-generation"),
      styleRules: deps.loadPrompt("style-rules"),
      drawingRules: deps.loadPrompt("drawing-rules-ascii"),
    });
    const reply = await deps.gate("门2 · 确认骨架", skeleton, bundle);
    if (reply === "") break; // 通过，继续内容生成
    if (reply === COPY_OUTLINE_SIGNAL || reply === "copy" || reply === "复制大纲") {
      // offload 分支：建空白文档 + 入索引 + 结束（跳过内容生成/审核/画图）
      if (!deps.publishBlank) throw new Error("publishBlank 未注入，无法执行复制大纲分支");
      const url = await deps.publishBlank(placement.title, placement);
      if (deps.updateIndex) {
        try { await deps.updateIndex(placement.title, url); }
        catch (e) { console.error(`  ⚠ 索引更新失败,跳过:${(e as Error).message}`); }
      }
      return { kind: "outline_copied", url, bundle, feedbacks };
    }
    // 修改意见：重跑内容组织（保持原门迭代语义）
    collect({ gate: "门2 · 确认骨架", feedback: reply });
    const user = `${orgUser}\n\n【上一版产出】\n${skeleton}\n\n【使用者修改意见】\n${reply}\n\n请据此修改后重新输出(保持同样的格式)。`;
    skeleton = await deps.runRole("contentOrganization", { system: orgSystem, user });
  }
```

（`placement` 变量在此之前已由 `parsePlacement(outline1, userInput)` 得到，两个 PlacementInfo 变体都含 `title` 字段。后续内容生成段原样不动，继续用 `skeleton`。）

- [ ] **Step 4: typecheck**

Run: `npx tsc --noEmit`
Expected: 可能因 server.ts/cli.ts 尚未提供 publishBlank 而报错？——不会，publishBlank 是**可选**字段，不强制。应零报错（或只剩后续任务无关的既有报错）。若报错与本改动相关则修。

### 3c. 测试

- [ ] **Step 5: 先跑现有 orchestrator 测试确认门2 重构没破坏回归**

Run: `npx vitest run tests/orchestrator.test.ts`
Expected: 现有全部用例仍 PASS（门2 通过路径、门2 反馈路径、拆分、dedup 等）。若挂，说明重构改变了行为，需对照原 iterateWithGate 语义修正（重点：反馈的 gate 标题仍是"门2 · 确认骨架"、通过返回当前 skeleton、反馈重跑）。

- [ ] **Step 6: 加 offload 分支失败测试**

在 `tests/orchestrator.test.ts` 末尾追加（import 顶部补 `COPY_OUTLINE_SIGNAL`）：

```ts
import { runPipeline, extractTitle, COPY_OUTLINE_SIGNAL, type PipelineDeps, type PipelineResult } from "../src/orchestrator.js";

describe("门2 复制大纲 offload 分支", () => {
  it("门2 返回哨兵 → 建空文档+入索引+结束，不跑生成/审核", async () => {
    const loadPrompt = (n: string) => `[${n}]`;
    const runRole = vi.fn(async (role: string) => {
      if (role === "questionAnalysis") return "## 文档标题\npnpm 原理\n## 归档位置\n技术\n";
      if (role === "contentOrganization") return "# pnpm\n## 1. 问题\n### 1.1\n- 体量: 中, 约 200 字";
      return "SHOULD_NOT_BE_CALLED:" + role;
    });
    // 门1 通过("")，门2 返回哨兵
    const gate = vi.fn()
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce(COPY_OUTLINE_SIGNAL);
    const publishBlank = vi.fn().mockResolvedValue("http://blank-doc");
    const updateIndex = vi.fn().mockResolvedValue(undefined);

    const res = await runPipeline("讲讲 pnpm", {
      loadPrompt, runRole, gate,
      publish: vi.fn().mockResolvedValue("u"),
      publishBlank, updateIndex,
    });

    expect(res.kind).toBe("outline_copied");
    if (res.kind === "outline_copied") {
      expect(res.url).toBe("http://blank-doc");
      expect(res.bundle).toContain("pnpm");          // bundle 含骨架
      expect(res.bundle).toContain("资深技术作者");   // bundle 含 framing
    }
    expect(publishBlank).toHaveBeenCalledTimes(1);
    expect(updateIndex).toHaveBeenCalledTimes(1);
    // 关键：没跑内容生成/审核
    expect(runRole).not.toHaveBeenCalledWith("contentGeneration", expect.anything());
    expect(runRole).not.toHaveBeenCalledWith("contentReview", expect.anything());
  });
});
```

- [ ] **Step 7: 跑测试确认失败→实现已就位→通过**

Run: `npx vitest run tests/orchestrator.test.ts`
Expected: 新用例 PASS（实现已在 3b 完成）。若新用例挂，检查 gate 调用序（门1 是否恰好消耗第一个 mock）、publishBlank guard、返回类型。

- [ ] **Step 8: 全量 + typecheck + 提交**

```bash
npx vitest run
npx tsc --noEmit
git add src/io.ts src/orchestrator.ts tests/orchestrator.test.ts
git commit -m "feat: orchestrator 门2 复制大纲 offload 分支 + 哨兵信号"
```

---

## Task 4: server 装配（bundle 转发 + publishBlank）

**Files:**
- Modify: `src/server.ts`

server 无独立单测，靠 `npx tsc --noEmit`。

- [ ] **Step 1: GateEvent 加 bundle**

`src/server.ts` 的 GateEvent 定义（约 84 行）：
```ts
export interface GateEvent         { type: "gate";            title: string; content: string }
```
改为：
```ts
export interface GateEvent         { type: "gate";            title: string; content: string; bundle?: string }
```

- [ ] **Step 2: gate 实现转发 bundle**

`buildDeps` 里的 `gate` 函数（约 264 行）签名加第三参并推进事件：
```ts
  const gate = async (title: string, content: string, bundle?: string): Promise<string> => {
    if (!appSettings.gate1Enabled && title.startsWith("门1")) return "";
    return new Promise((resolve) => {
      const run = runs.get(runId);
      if (!run) { resolve(""); return; }
      run.gateResolver = resolve;
      pushEvent(runId, { type: "gate", title, content, bundle });
    });
  };
```

- [ ] **Step 3: 加 publishBlank 依赖**

在 `buildDeps` 里 `publish` 定义之后追加 `publishBlank`（dry-run 时返回假 URL）：
```ts
  const publishBlank = async (title: string, placement: PlacementInfo): Promise<string> => {
    if (dryRun) return `(dry-run) 空白文档「${title}」`;
    let folderToken: string;
    let folderName: string;
    if (placement.type === "new") {
      folderToken = await larkCreateFolder(placement.folderName, placement.parentToken);
      folderName = placement.folderName;
    } else {
      folderToken = placement.folderToken;
      folderName = placement.title;
    }
    const url = await larkCreateDoc(`# ${title}`, "markdown", folderToken);
    pushEvent(runId, { type: "doc_created", url, folderName });
    dbSetDocUrl(runId, url, folderName);
    dbSetDocTitle(runId, title);
    return url;
  };
```

- [ ] **Step 4: 把 publishBlank 加进返回的 deps**

`buildDeps` 末尾 `return { loadPrompt, runRole, gate, publish, ... }` 里追加 `publishBlank,`。

- [ ] **Step 5: 结果收口无需特判**

确认 runPipeline 结果处理（约 465 行）的 `else` 分支对 `outline_copied` 已发 `{ type: "done", kind: "single" }`，且空文档 URL 已由 publishBlank 内部的 `doc_created` 发出——无需新增分支。仅需目视确认。

- [ ] **Step 6: typecheck + 提交**

```bash
npx tsc --noEmit
git add src/server.ts
git commit -m "feat: server 转发 bundle 事件 + publishBlank 建空文档"
```

---

## Task 5: cli 装配（publishBlank + 处理 outline_copied）

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: import writeFileSync（若未 import）**

确认 `src/cli.ts` 顶部有 `import { writeFileSync } from "node:fs";`（或 `node:fs` 已 import writeFileSync）。没有则加。

- [ ] **Step 2: 加 publishBlank 依赖并注入 runPipeline**

在 cli 的 `runPipeline(userInput, { ... })` 的 deps 对象里（约 215 行）追加 `publishBlank`。deps 里已有 `publish`（内含建文件夹逻辑），仿它加：
```ts
      publishBlank: async (title, placement) => {
        let folderToken: string;
        if (placement.type === "new") {
          console.error(`  📁 新建文件夹「${placement.folderName}」…`);
          folderToken = await larkCreateFolder(placement.folderName, placement.parentToken);
        } else {
          folderToken = placement.folderToken;
        }
        const url = await larkCreateDoc(`# ${title}`, "markdown", folderToken);
        console.log("\n✅ 空白文档已建好:", url);
        return url;
      },
```
（若同一 deps 对象也用于拆分子流程的第二个 runPipeline 调用，同样补上 publishBlank；或提取成变量复用。）

- [ ] **Step 3: 处理 outline_copied 结果**

在 cli 处理 `result.kind` 的地方（`result.kind === "single"` 分支附近），新增：
```ts
    if (result.kind === "outline_copied") {
      const bundlePath = "./outline-bundle.md";
      writeFileSync(bundlePath, result.bundle, "utf8");
      console.log(`\n📋 大纲 bundle 已写入 ${bundlePath}（粘贴到 AI 中台）`);
      console.log(`📄 空白文档: ${result.url}`);
      return; // 结束（不走蒸馏等后续）
    }
```
放在 split 处理之后、single/蒸馏处理之前，确保 outline_copied 提前返回。

- [ ] **Step 4: typecheck + 提交**

```bash
npx tsc --noEmit
git add src/cli.ts
git commit -m "feat: cli 支持复制大纲(输入 copy)与 outline_copied 收口"
```

---

## Task 6: 前端「复制大纲」按钮

**Files:**
- Modify: `web/lib/types.ts`（GateEvent 加 bundle + 导出信号常量）
- Modify: `web/components/GateViewer.tsx`（按钮）

- [ ] **Step 1: web GateEvent 加 bundle + 信号常量**

`web/lib/types.ts` 的 GateEvent（约 4 行）：
```ts
export interface GateEvent           { type: "gate";            title: string; content: string }
```
改为：
```ts
export interface GateEvent           { type: "gate";            title: string; content: string; bundle?: string }
```
文件末尾追加（与后端同值）：
```ts
/** 门2「复制大纲」哨兵，与后端 orchestrator 保持一致 */
export const COPY_OUTLINE_SIGNAL = "__COPY_OUTLINE__";
```

- [ ] **Step 2: GateViewer 加按钮**

`web/components/GateViewer.tsx` 顶部 import 追加 `COPY_OUTLINE_SIGNAL`（从 `@/lib/types`）。在**非 readOnly** 的底部输入区（内联那块，`通过↵/提交意见` 按钮旁），当 `event.bundle` 非空时渲染一个「复制大纲」按钮：
```tsx
            {event.bundle && (
              <button
                type="button"
                onClick={async () => {
                  try { await navigator.clipboard.writeText(event.bundle!); }
                  catch { /* 剪贴板不可用时忽略，仍继续提交信号 */ }
                  onSubmit?.(COPY_OUTLINE_SIGNAL);
                }}
                className="px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap bg-emerald-600 hover:bg-emerald-500 text-white transition-colors shadow-sm"
              >
                复制大纲
              </button>
            )}
```
放在现有提交按钮相邻位置（同一 flex 容器内）。`onSubmit` 是组件已有的回调 prop。

- [ ] **Step 3: typecheck**

Run: `npx tsc --noEmit`
Expected: 零报错。

- [ ] **Step 4: 提交**

```bash
git add web/lib/types.ts web/components/GateViewer.tsx
git commit -m "feat: 门2 前端复制大纲按钮(写剪贴板+发哨兵)"
```

---

## Task 7: 全量验证 + 推送

**Files:** 无（验证）

- [ ] **Step 1: 全量测试 + typecheck**

```bash
npx vitest run && npx tsc --noEmit
```
Expected: 全绿 + 零报错。

- [ ] **Step 2: 推送**

```bash
git push origin main
```

- [ ] **Step 3: 留给用户手动验的**

真实跑一次门2，点「复制大纲」：确认 (a) 剪贴板拿到完整 bundle（含骨架+生成方法论+风格+画图规范），(b) 飞书出现仅含标题的空白文档且进了总索引，(c) 粘贴 bundle 到 AI 中台能产出带字符图的完整文档。

---

## 完成后

用 `superpowers:finishing-a-development-branch` 收尾（或按用户要求直接 push——见 Task 7）。
