# ASCII 字符画图模式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 ASCII 字符画图成为默认画图方式，SVG 降级为设置开关项（默认关），大幅降低画图 token 成本。

**Architecture:** 保留现有「`【配图指令】` 占位符 → `patchDiagrams` 并行生成 + 串行写入 + 校验重试」骨架不变，在渲染步骤按 `mode: "ascii" | "svg"` 分流。内容生成 agent 不改。ASCII 写入飞书 markdown 围栏代码块，SVG 写入飞书画板。

**Tech Stack:** TypeScript ESM + Node 20 + Hono + Next.js/React + vitest + zod。依赖注入（fake runRole/loadPrompt）。

**参考 spec:** `docs/superpowers/specs/2026-08-05-ascii-diagram-mode-design.md`

---

## 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/settingsStore.ts` | AppSettings zod schema | 加 `svgDiagram` |
| `web/lib/settingsTypes.ts` | 前端 AppSettings 类型 + role labels | 加 `svgDiagram`，relabel `diagramSvg` |
| `src/tools/ascii.ts` | ASCII 提取 + 校验（新） | 创建 |
| `prompts/drawing-rules-ascii.md` | 厚画图规范（新） | 创建 |
| `prompts/diagram-ascii.md` | ASCII 角色 prompt（新） | 创建 |
| `src/diagrams.ts` | 按 mode 分流 renderDiagram/wrap | 改造 |
| `src/server.ts` | 装配 mode + 作图状态事件 | 改造 |
| `src/cli.ts` | 装配 mode（env 开关） | 改造 |
| `web/components/SettingsModal.tsx` | SVG 开关行 | 加一行 |
| `tests/ascii.test.ts` | ascii 工具单测（新） | 创建 |
| `tests/diagrams.test.ts` | 补 mode 分流用例 | 改造 |
| `tests/settings.test.ts` | 补 svgDiagram 默认值 | 改造 |

## 类型契约（贯穿全计划，务必一致）

- `export type DiagramMode = "ascii" | "svg"`（定义在 `src/diagrams.ts`）
- `DiagramDeps.mode: DiagramMode`（**必填**，无默认——让编译器强制所有调用点传值）
- `extractAsciiBlock(text: string): string`（无代码块时 throw）
- `lintAscii(ascii: string): { ok: boolean; issues: string[] }`
- `PatchDeps` 新增可选回调：`onDiagramStart?(instruction: string): void`、`onDiagramDone?(instruction: string): void`（保留现有 `onProgress`/`onError`）
- role id 保持 `diagramSvg` 不变；仅显示 label 改为「作图」
- server 端 `mode = appSettings.svgDiagram ? "svg" : "ascii"`；cli 端 `mode = process.env.SVG_DIAGRAM === "1" ? "svg" : "ascii"`

---

## Task 1: 设置项 `svgDiagram`（默认 false = ASCII）

**Files:**
- Modify: `src/settingsStore.ts`（`AppSettingsSchema`）
- Modify: `web/lib/settingsTypes.ts`（`AppSettings` 接口）
- Test: `tests/settings.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/settings.test.ts` 的 `describe("settingsStore", …)` 里追加：

```ts
  it("svgDiagram 默认 false（默认字符画图）", () => {
    const s = loadSettings(p);
    expect(s.svgDiagram).toBe(false);
  });

  it("可开启 svgDiagram 并持久化", () => {
    saveSettings({ svgDiagram: true }, p);
    expect(loadSettings(p).svgDiagram).toBe(true);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/settings.test.ts`
Expected: FAIL — `svgDiagram` 不存在（类型错误或 undefined）

- [ ] **Step 3: 加 schema 字段**

`src/settingsStore.ts` 的 `AppSettingsSchema` 里，在 `maxReviewRetries` 那行后追加：

```ts
  svgDiagram:            z.boolean().default(false),
```

- [ ] **Step 4: 加前端类型**

`web/lib/settingsTypes.ts` 的 `AppSettings` 接口里，在 `maxReviewRetries: number;` 后追加：

```ts
  svgDiagram:            boolean;
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/settings.test.ts`
Expected: PASS

- [ ] **Step 6: typecheck + 提交**

```bash
npx tsc --noEmit
git add src/settingsStore.ts web/lib/settingsTypes.ts tests/settings.test.ts
git commit -m "feat: 加 svgDiagram 设置项（默认 false=字符画图）"
```

---

## Task 2: `src/tools/ascii.ts` — 提取与校验

**Files:**
- Create: `src/tools/ascii.ts`
- Test: `tests/ascii.test.ts`（新建）

**设计要点：** `extractAsciiBlock` 从 agent 输出提取第一个围栏代码块内容；`lintAscii` 做务实校验（禁用 Unicode 制表符 / 行宽 ≤ 100 中文按 2 列 / 非空），不做 junction 审计。

- [ ] **Step 1: 写 extractAsciiBlock 失败测试**

创建 `tests/ascii.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { extractAsciiBlock, lintAscii } from "../src/tools/ascii.js";

describe("extractAsciiBlock", () => {
  it("提取裸围栏代码块内容", () => {
    const out = "说明\n```\n+--+\n|A |\n+--+\n```\n尾部";
    expect(extractAsciiBlock(out)).toBe("+--+\n|A |\n+--+");
  });

  it("提取带语言标注的围栏（```text）", () => {
    const out = "```text\n+--+\n```";
    expect(extractAsciiBlock(out)).toBe("+--+");
  });

  it("无代码块时抛错", () => {
    expect(() => extractAsciiBlock("没有围栏")).toThrow();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/ascii.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现 extractAsciiBlock**

创建 `src/tools/ascii.ts`：

```ts
/**
 * tools/ascii.ts — ASCII 字符图提取与校验
 *
 * 与 tools/svg.ts 平行：extractAsciiBlock 从 agent 输出取围栏代码块，
 * lintAscii 做务实校验（禁用 Unicode 制表符 / 行宽 / 非空），
 * 问题描述原样喂回作图 agent 做下一轮修正。
 */

/**
 * 从 agent 输出中提取第一个围栏代码块（```…```）的内容。
 * 支持带语言标注（```text）和裸围栏。
 * @throws 若找不到围栏代码块则抛错（调用方捕获后喂回 agent 修正）
 */
export function extractAsciiBlock(text: string): string {
  const m = text.match(/```[^\n]*\n([\s\S]*?)```/);
  if (!m) throw new Error("未找到围栏代码块(生成结果里应含一个 ```…``` 代码块)");
  return m[1].replace(/\n$/, "");
}
```

- [ ] **Step 4: 跑测试确认 extract 通过**

Run: `npx vitest run tests/ascii.test.ts -t extractAsciiBlock`
Expected: PASS（lintAscii 相关用例尚未写，不影响）

- [ ] **Step 5: 写 lintAscii 失败测试**

在 `tests/ascii.test.ts` 末尾追加：

```ts
describe("lintAscii", () => {
  const good = "+------+\n|  节点  |\n+------+";

  it("正常图通过", () => {
    expect(lintAscii(good).ok).toBe(true);
  });

  it("含禁用 Unicode 制表符 → 失败", () => {
    const r = lintAscii("┌────┐\n│ A  │\n└────┘");
    expect(r.ok).toBe(false);
    expect(r.issues.join()).toMatch(/Unicode|制表|禁用/);
  });

  it("行宽超 100 列 → 失败（中文按 2 列）", () => {
    const r = lintAscii("阿".repeat(51)); // 51*2 = 102 列
    expect(r.ok).toBe(false);
    expect(r.issues.join()).toMatch(/宽|列|100/);
  });

  it("中文 40 字 = 80 列，未超宽 → 通过", () => {
    expect(lintAscii("阿".repeat(40)).ok).toBe(true);
  });

  it("空内容 → 失败", () => {
    expect(lintAscii("   \n  ").ok).toBe(false);
  });
});
```

- [ ] **Step 6: 跑测试确认失败**

Run: `npx vitest run tests/ascii.test.ts -t lintAscii`
Expected: FAIL — `lintAscii` 未实现

- [ ] **Step 7: 实现 displayWidth + lintAscii**

在 `src/tools/ascii.ts` 末尾追加：

```ts
export interface AsciiLintResult {
  ok: boolean;
  issues: string[];
}

// 东亚宽字符近似判定：CJK 表意文字 / 全角标点 / Hangul 等按 2 列
function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0xa4cf) || // CJK 部首 … 表意文字
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul 音节
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK 兼容表意
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK 兼容符号
    (cp >= 0xff00 && cp <= 0xff60) || // 全角 ASCII
    (cp >= 0xffe0 && cp <= 0xffe6)    // 全角符号
  );
}

/** 一行的显示列宽（中文/全角按 2 列） */
export function displayWidth(line: string): number {
  let w = 0;
  for (const ch of line) w += isWide(ch.codePointAt(0)!) ? 2 : 1;
  return w;
}

// 飞书代码块渲染会把这些 Unicode 制表符/装饰符弄乱；LLM 最爱误用
const BANNED_UNICODE = /[─-╿■-◿]/;
const MAX_WIDTH = 100;

/**
 * 务实版 ASCII 图校验：
 *   ① 禁用 Unicode 制表符/装饰符
 *   ② 每行显示列宽 ≤ 100（中文按 2 列）
 *   ③ 内容非空
 * 不做 junction 对齐审计（太脆，靠 prompt 纪律）。
 */
export function lintAscii(ascii: string): AsciiLintResult {
  const issues: string[] = [];
  if (!ascii.trim()) {
    issues.push("图内容为空");
    return { ok: false, issues };
  }
  if (BANNED_UNICODE.test(ascii)) {
    issues.push("使用了禁用的 Unicode 制表符/装饰符(如 ┌─┐│●▶)，只能用 + - | > < ^ v");
  }
  const lines = ascii.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const w = displayWidth(lines[i]);
    if (w > MAX_WIDTH) {
      issues.push(`第 ${i + 1} 行宽 ${w} 列，超过 ${MAX_WIDTH} 列上限(中文按 2 列计)`);
    }
  }
  return { ok: issues.length === 0, issues };
}
```

- [ ] **Step 8: 跑全部 ascii 测试确认通过**

Run: `npx vitest run tests/ascii.test.ts`
Expected: PASS（全部）

- [ ] **Step 9: typecheck + 提交**

```bash
npx tsc --noEmit
git add src/tools/ascii.ts tests/ascii.test.ts
git commit -m "feat: 加 ascii 工具 extractAsciiBlock + lintAscii"
```

---

## Task 3: 两个 prompt 文件（厚规范 + 角色）

**Files:**
- Create: `prompts/drawing-rules-ascii.md`（厚规范，150~250 行）
- Create: `prompts/diagram-ascii.md`（角色 prompt，薄）

**说明：** 这是纯 prompt 文件，无单测。**输出时分多次 Edit 追加，不要一次写满**（大文本块会触发接口报错）。规范内容严格按 spec 第 4 节的 A~G 七部分组织。

### 3a. `prompts/drawing-rules-ascii.md` 必含的七部分

完整清单见 `docs/superpowers/specs/2026-08-05-ascii-diagram-mode-design.md` 第 4 节，逐条落地：

- **A. 硬约束**：只允许 `+ - | > < ^ v`（斜线少用）；禁用 `┌ ┐ └ ┘ ─ │ ├ ┤ ┬ ┴ ┼ ╔ ╗ ╚ ╝ ═ ║ ╭ ╮ ╰ ╯ ▶ ▼ ◀ ▲ ● ○ ◆ ◇`；中文/全角按 2 列宽；宽度 ≤ 80（最大 100）
- **B. 三阶段 PLAN → DRAW → VERIFY**：PLAN 算框宽（文字列数含中文×2 + 左右各 1 空格 + 2 边框）建列标尺；DRAW 按列位落字；VERIFY 逐项自检
- **C. 绘制约定**：Junction 规则（`|` 进出横线处该列必有 `+`）；箭头贴边不悬空；框内文字左右各 ≥ 1 空格；同层框等宽；边标签放连线旁
- **D. VERIFY 自检清单**（6 条打勾项，照抄 spec 第 4 节 D）
- **E. 分图型 few-shot 范例**（每型 ≥ 1 个带中文标签、严格对齐）：横向流程 / 纵向决策 / 分层架构 / 时序 / 关系图 — 见下方 3c 提供的标尺范例
- **F. 反例**（错误→修正）：① `┌─┐`（错）vs `+--+`（对）；② 中文按 1 列算导致边框错位（错）vs 按 2 列算准（对）
- **G. 产出**：只输出一个围栏代码块，块内纯图，块外无解释

写作风格参照现有 `prompts/drawing-rules.md`（中文、分节、约束在前范例在后）。

### 3c. E 节必须嵌入的黄金范例（已按中文 2 列宽算准，直接抄进规范文件）

**横向流程**（框 + `----->`）：

```
+------------+      +--------+      +--------+
|  用户请求  |----->|  网关  |----->|  服务  |
+------------+      +--------+      +--------+
```

**分层架构**（纵向层 + `|`/`v`）：

```
+--------------+
|     前端     |
+--------------+
       |
       v
+--------------+
|     后端     |
+--------------+
       |
       v
+--------------+
|    数据库    |
+--------------+
```

**时序图**（参与者泳道 + 横向消息）：

```
  客户端              服务器
    |                   |
    |----- 请求 ------->|
    |                   |
    |<---- 响应 --------|
    |                   |
```

实现者可另加「纵向决策分支」和「关系/数据流」两型的范例（自己数准列宽即可）。

### 3b. `prompts/diagram-ascii.md`（薄角色 prompt）

参照现有 `prompts/diagram-svg.md` 的结构，改写为字符图版本。要点：

- 角色：字符图绘制者，把一条 `【配图指令:<描述>】` + 上下文画成一张对齐、清晰、准确的 ASCII 图
- 输出：**一个围栏代码块**，块内纯图，严格遵循随后附上的《作图规范》
- 强调先判断图型（流程/架构/分层/时序/关系）再按 PLAN→DRAW→VERIFY 落笔
- 修正循环：收到校验诊断（如"使用了禁用 Unicode 字符""某行超宽"）后逐条修正，重出完整代码块，不复述诊断

- [ ] **Step: 分块写两个文件后提交**

分多次 Edit 追加写完 `prompts/drawing-rules-ascii.md`（A~G 七部分 + 3c 范例），再写 `prompts/diagram-ascii.md`。

```bash
git add prompts/drawing-rules-ascii.md prompts/diagram-ascii.md
git commit -m "feat: 加字符画图规范与角色 prompt"
```

---

## Task 4: `src/diagrams.ts` 按 mode 分流

**Files:**
- Modify: `src/diagrams.ts`
- Test: `tests/diagrams.test.ts`

**核心：** `DiagramDeps` 加必填 `mode`；`renderDiagram` 按 mode 选 prompt/规范/提取/校验；新增 `wrapDiagram` 决定写入包装（画板 vs 代码块）。

- [ ] **Step 1: 给现有测试补 mode，加 ascii 新用例**

`tests/diagrams.test.ts` 里**每一处** `renderDiagram`/`renderDiagrams`/`patchDiagrams` 的 deps 对象都加 `mode: "svg"`（保持现有 SVG 用例行为不变）。例如：

```ts
const svg = await renderDiagram({ raw: "【配图指令:x】", instruction: "x" }, "ctx", {
  loadPrompt, runRole, mode: "svg",
});
```

然后在文件末尾追加 ascii 用例：

```ts
describe("renderDiagram ascii 模式", () => {
  it("提取纯 ascii 块并通过校验", async () => {
    const runRole = vi.fn().mockResolvedValue("```\n+--+\n```");
    const out = await renderDiagram(
      { raw: "【配图指令:x】", instruction: "x" }, "ctx",
      { loadPrompt, runRole, mode: "ascii" },
    );
    expect(out).toBe("+--+");
    // 应加载 ascii 规范而非 svg
    expect(runRole.mock.calls[0][1].system).toMatch(/DIAGRAM-ASCII|DRAWING-RULES-ASCII/);
  });
});

describe("renderDiagrams ascii 包装", () => {
  it("替换为围栏代码块，不含 whiteboard", async () => {
    const runRole = vi.fn().mockResolvedValue("```\n+--+\n|甲|\n+--+\n```");
    const md = "前言\n【配图指令:示意】\n后语";
    const result = await renderDiagrams(md, { loadPrompt, runRole, mode: "ascii" });
    expect(result).toContain("```");
    expect(result).toContain("+--+");
    expect(result).not.toContain("whiteboard");
  });
});
```

（`loadPrompt = (n) => n.toUpperCase()` 已在文件顶部定义，故 system 里会出现大写的 `DIAGRAM-ASCII`/`DRAWING-RULES-ASCII`。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/diagrams.test.ts`
Expected: FAIL — ascii 用例挂（当前 renderDiagram 忽略 mode，永远走 svg 路径）

- [ ] **Step 3: 改类型 + 加 wrapDiagram + import**

`src/diagrams.ts` 顶部 import 追加：

```ts
import { extractAsciiBlock, lintAscii } from "./tools/ascii.js";
```

`DiagramSpec` 定义后追加类型，并改 `DiagramDeps`：

```ts
export type DiagramMode = "ascii" | "svg";

export interface DiagramDeps {
  loadPrompt: (name: string) => string;
  runRole: (role: AgentRole, input: AgentInput) => Promise<string>;
  mode: DiagramMode;      // 必填：ascii(默认) | svg
  maxRetries?: number;
}

/** 按 mode 决定写入飞书的包装：SVG→画板，ASCII→围栏代码块 */
function wrapDiagram(mode: DiagramMode, block: string): string {
  return mode === "svg"
    ? `<whiteboard type="svg">${block}</whiteboard>`
    : "\n```\n" + block + "\n```\n";
}
```

- [ ] **Step 4: 改 renderDiagram 按 mode 分流**

把现有 `renderDiagram` 函数体替换为：

```ts
export async function renderDiagram(
  spec: DiagramSpec,
  context: string,
  deps: DiagramDeps,
): Promise<string | null> {
  const rolePrompt = deps.mode === "svg" ? "diagram-svg" : "diagram-ascii";
  const rulesPrompt = deps.mode === "svg" ? "drawing-rules" : "drawing-rules-ascii";
  const system = `${deps.loadPrompt(rolePrompt)}\n\n---\n\n${deps.loadPrompt(rulesPrompt)}`;
  const extract = deps.mode === "svg" ? extractSvg : extractAsciiBlock;
  const lint: (s: string) => { ok: boolean; issues: string[] } =
    deps.mode === "svg" ? lintSvg : lintAscii;
  const maxRetries = deps.maxRetries ?? 2;
  let feedback = "";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const user = `【配图指令:${spec.instruction}】\n\n【上下文】\n${context}${feedback}`;
    const out = await deps.runRole("diagramSvg", { system, user });

    let block: string;
    try {
      block = extract(out);
    } catch {
      feedback = deps.mode === "svg"
        ? "\n\n【上一版问题】没有输出有效的 <svg> 块，请只输出一个完整的 <svg>…</svg>。"
        : "\n\n【上一版问题】没有输出围栏代码块，请只输出一个 ```…``` 代码块，块内是纯字符图。";
      continue;
    }

    const res = lint(block);
    if (res.ok) return block;
    feedback = `\n\n【上一版校验未通过，请逐条修正后重出】\n${res.issues.join("\n")}`;
  }
  return null;
}
```

- [ ] **Step 5: 两处写入点改用 wrapDiagram**

`renderDiagrams` 里（内联渲染）：

```ts
    if (svg) {
      result = result.replace(spec.raw, wrapDiagram(deps.mode, svg));
    }
```

`patchDiagrams` 的 updateChain 里：

```ts
      updateChain = updateChain.then(async () => {
        await deps.updateDoc(docUrl, spec.raw, wrapDiagram(deps.mode, svg));
        patched++;
        deps.onProgress?.(`  ✅ 已补 ${patched}/${specs.length} 张:${spec.instruction}`);
      });
```

- [ ] **Step 6: 跑全部 diagrams 测试确认通过**

Run: `npx vitest run tests/diagrams.test.ts`
Expected: PASS（含新 ascii 用例与保留的 svg 用例）

- [ ] **Step 7: typecheck + 提交**

```bash
npx tsc --noEmit
git add src/diagrams.ts tests/diagrams.test.ts
git commit -m "feat: diagrams 按 mode 分流 ascii/svg"
```

---

## Task 5: 作图状态回调 + server 装配

**Files:**
- Modify: `src/diagrams.ts`（`PatchDeps` 加 `onDiagramStart`/`onDiagramDone` 并调用）
- Modify: `src/server.ts`（mode、modeLabel、状态事件、relabel）
- Test: `tests/diagrams.test.ts`

### 5a. diagrams.ts 状态回调

- [ ] **Step 1: 写失败测试**

在 `tests/diagrams.test.ts` 里 patchDiagrams 相关 describe 追加：

```ts
  it("触发 onDiagramStart / onDiagramDone", async () => {
    const runRole = vi.fn().mockResolvedValue("```\n+--+\n```");
    const started: string[] = [];
    const done: string[] = [];
    await patchDiagrams("【配图指令:图甲】", "http://doc", {
      loadPrompt, runRole, mode: "ascii",
      updateDoc: async () => {},
      onDiagramStart: (i) => started.push(i),
      onDiagramDone: (i) => done.push(i),
    });
    expect(started).toEqual(["图甲"]);
    expect(done).toEqual(["图甲"]);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/diagrams.test.ts -t onDiagramStart`
Expected: FAIL — 回调未定义/未调用

- [ ] **Step 3: 扩展 PatchDeps 并调用**

`src/diagrams.ts` 的 `PatchDeps` 接口追加两个可选回调：

```ts
export interface PatchDeps extends DiagramDeps {
  updateDoc: (docUrl: string, pattern: string, content: string) => Promise<void>;
  onProgress?: (msg: string) => void;
  onError?: (instruction: string, reason: string) => void;
  onDiagramStart?: (instruction: string) => void; // 单张图开始生成
  onDiagramDone?: (instruction: string) => void;   // 单张图已写入飞书
}
```

`patchDiagrams` 的 renders 映射改为（生成前触发 start，写入后触发 done）：

```ts
  const renders = specs.map((spec, i) => {
    deps.onDiagramStart?.(spec.instruction);
    return renderDiagram(spec, context, deps).then((svg) => {
      if (!svg) {
        deps.onProgress?.(`  ⚠ 第 ${i + 1}/${specs.length} 张校验未过,保留文字占位:${spec.instruction}`);
        deps.onError?.(spec.instruction, "校验超出重试次数");
        return;
      }
      updateChain = updateChain.then(async () => {
        await deps.updateDoc(docUrl, spec.raw, wrapDiagram(deps.mode, svg));
        patched++;
        deps.onDiagramDone?.(spec.instruction);
        deps.onProgress?.(`  ✅ 已补 ${patched}/${specs.length} 张:${spec.instruction}`);
      });
    });
  });
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/diagrams.test.ts`
Expected: PASS（全部）

### 5b. server.ts 装配 mode + 状态事件

server.ts 无独立单测，靠 `npx tsc --noEmit` 把关（mode 必填会强制所有调用点）。

- [ ] **Step 5: import DiagramMode**

`src/server.ts` 从 diagrams 的 import 追加 `DiagramMode`：

```ts
import { renderDiagrams, patchDiagrams, extractDiagramSpecs, type DiagramMode } from "./diagrams.js";
```

（若现有 import 行不同，合并即可，确保引入 `DiagramMode`。）

- [ ] **Step 6: relabel diagramSvg**

`ROLE_LABEL` 里 `diagramSvg: "SVG 作图"` 改为：

```ts
  diagramSvg:          "作图",
```

- [ ] **Step 7: buildDeps 里算 mode 与 modeLabel**

在 `buildDeps` 内 `const noDiagram = ...` 附近追加：

```ts
  const mode: DiagramMode = appSettings.svgDiagram ? "svg" : "ascii";
  const modeLabel = appSettings.svgDiagram ? "SVG 作图" : "字符作图";
```

- [ ] **Step 8: dry-run renderDiagrams 传 mode**

publish 的 dry-run 分支：

```ts
      const md = noDiagram ? markdown : await renderDiagrams(markdown, { loadPrompt, runRole, mode });
```

- [ ] **Step 9: publish 的 patchDiagrams 加 mode + 状态回调**

把 publish 里 `patchDiagrams(markdown, url, {...})` 的 deps 换成：

```ts
      patchDiagrams(markdown, url, {
        loadPrompt, runRole, mode,
        updateDoc: (u, p, c) => larkUpdateStrReplace(u, p, c),
        onProgress: () => {},
        onDiagramStart: (inst) =>
          pushEvent(runId, { type: "step_start", role: "diagramSvg", label: `${modeLabel}：${inst.slice(0, 40)}` }),
        onDiagramDone: (inst) =>
          pushEvent(runId, { type: "progress", role: "diagramSvg", label: `${modeLabel}：${inst.slice(0, 40)}` }),
        onError: (inst, reason) =>
          pushEvent(runId, { type: "step_error", label: `${modeLabel}：${inst.slice(0, 40)}`, message: reason }),
      }).catch((e) =>
        pushEvent(runId, { type: "step_error", label: modeLabel, message: (e as Error).message }),
      );
```

- [ ] **Step 10: patchDocDiagrams 加 mode + 状态回调**

把 `patchDocDiagrams` 里的 `patchDiagrams(content, docUrl, {...})` deps 换成同上结构（`loadPrompt, runRole, mode,` + 三个状态回调），其中 onError/onDiagramStart/onDiagramDone 的 label 同样用 `` `${modeLabel}：${inst.slice(0, 40)}` ``。开头两个占位的 `step_start`/`progress`（"读取原文档"）保持不变。

- [ ] **Step 11: typecheck + 提交**

```bash
npx tsc --noEmit
git add src/diagrams.ts src/server.ts tests/diagrams.test.ts
git commit -m "feat: 作图状态可见（每图独立节点）+ server 装配 mode"
```

---

## Task 6: `src/cli.ts` 装配 mode（env 开关）

**Files:**
- Modify: `src/cli.ts`

CLI 用环境变量开关，沿用现有 `NO_DIAGRAM`/`NO_SEARCH` env 风格。无单测，靠 typecheck 把关。

- [ ] **Step 1: import DiagramMode**

`src/cli.ts` 的 `import { renderDiagrams, patchDiagrams } from "./diagrams.js";` 改为：

```ts
import { renderDiagrams, patchDiagrams, type DiagramMode } from "./diagrams.js";
```

- [ ] **Step 2: 定义 diagramMode**

在 `const noDiagram = process.env.NO_DIAGRAM === "1";` 后追加：

```ts
  const diagramMode: DiagramMode = process.env.SVG_DIAGRAM === "1" ? "svg" : "ascii";
```

- [ ] **Step 3: 三处 deps 加 mode**

以下三处的 deps 对象都加 `mode: diagramMode`：
1. 增量补图（约 176 行）`patchDiagrams(r.incrementalMarkdown, r.url, { loadPrompt, runRole, mode: diagramMode, updateDoc: … })`
2. dry-run 内联（约 230 行）`renderDiagrams(markdown, { loadPrompt, runRole, mode: diagramMode })`
3. publish 补图（约 251 行）`patchDiagrams(markdown, url, { loadPrompt, runRole, mode: diagramMode, updateDoc: …, onProgress: (m) => console.error(m) })`

- [ ] **Step 4: 更新顶部注释**

`src/cli.ts` 文件头注释里 `NO_DIAGRAM=1  跳过 SVG 配图` 一行后补一行：

```
 *   SVG_DIAGRAM=1        用 SVG 画图(默认字符画图)
```

- [ ] **Step 5: typecheck + 提交**

```bash
npx tsc --noEmit
git add src/cli.ts
git commit -m "feat: cli 支持 SVG_DIAGRAM env 开关（默认字符画图）"
```

---

## Task 7: 前端 SVG 开关行 + relabel

**Files:**
- Modify: `web/components/SettingsModal.tsx`（新增开关行）
- Modify: `web/lib/settingsTypes.ts`（`AGENT_ROLE_LABELS` relabel）

- [ ] **Step 1: AGENT_ROLE_LABELS relabel**

`web/lib/settingsTypes.ts` 的 `AGENT_ROLE_LABELS` 里 `diagramSvg: "SVG 作图"` 改为：

```ts
  diagramSvg:          "作图",
```

- [ ] **Step 2: 加 SVG 开关行**

`web/components/SettingsModal.tsx` 在 Gate1 toggle 的 `</div>`（约 623 行）之后、`{/* maxReviewRetries */}` 之前插入：

```tsx
                  {/* SVG 画图开关 */}
                  <div className="flex items-center justify-between py-1">
                    <div>
                      <p className="text-sm font-medium text-gray-700">SVG 画图</p>
                      <p className="text-xs text-gray-400 mt-0.5">关闭时用字符图（更快更省 token）；开启后画飞书画板 SVG</p>
                    </div>
                    <button
                      type="button"
                      aria-label="SVG 画图开关"
                      aria-pressed={app.svgDiagram}
                      onClick={() => patchApp({ svgDiagram: !app.svgDiagram })}
                      className={`relative w-11 h-6 rounded-full transition-colors focus:outline-none ${
                        app.svgDiagram ? "bg-[rgb(var(--accent-500))]" : "bg-gray-300"
                      }`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                        app.svgDiagram ? "translate-x-5" : "translate-x-0"
                      }`} />
                    </button>
                  </div>
```

- [ ] **Step 3: typecheck + 提交**

```bash
npx tsc --noEmit
git add web/components/SettingsModal.tsx web/lib/settingsTypes.ts
git commit -m "feat: 设置面板加 SVG 画图开关 + 作图 relabel"
```

---

## Task 8: 全量验证 + 飞书代码块实测

**Files:** 无（验证任务）

- [ ] **Step 1: 全量测试 + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全部通过（含新增 ascii/mode 用例）

- [ ] **Step 2: 飞书围栏代码块实测（唯一需真跑的点）**

参考内存 `feishu-doc-gotchas`。真实跑一次（默认 ascii 模式）确认 `larkUpdateStrReplace` 把围栏代码块正确解析成飞书**代码块**（等宽、对齐不崩）。可用 CLI：

```bash
npx tsx src/cli.ts "用一句话解释事件循环，并配一张流程图"
```

Expected: 飞书文档里图渲染为等宽代码块，`+ - |` 对齐正常。
若代码块未被解析为飞书 code block（而是普通段落导致对齐崩），退化方案：`wrapDiagram` 的 ascii 分支改用飞书 XML `<code>` block 语法，并相应改 `larkCreateDoc`/`larkUpdateStrReplace` 的写入格式（此为 spec「错误处理」预案）。

- [ ] **Step 3: 若一切正常，无需额外提交**

前序任务已各自提交；本任务仅验证。

---

## 完成后

全部任务完成后，用 `superpowers:finishing-a-development-branch` 收尾。
