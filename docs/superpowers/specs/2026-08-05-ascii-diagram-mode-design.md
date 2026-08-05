# 字符画图（ASCII）模式设计

**日期：** 2026-08-05
**状态：** 已批准，待实现

## 目标

用「ASCII 字符画图」替代默认的 SVG 画图，大幅降低画图环节的 token 成本（每张图 ~15k → ~1-2k）和延迟。SVG 保留为设置面板里的开关项，默认关闭。

## 背景

当前画图占总 token 消耗的 ~57%（3 张 SVG 合计 ~47k）。SVG 冗长（XML + 坐标 + 内联样式），且每张图一次独立 API 调用。ASCII 图便宜、快，代价是 LLM 对齐能力差——需要靠机器校验 + 重试闭环兜底（参考 jasnell/opencode-skill-ascii-art-diagrams 的 PLAN/DRAW/VERIFY 工作流）。

## 架构

保留现有「`【配图指令】` 占位符 → `patchDiagrams` 并行生成 + 串行写入 + 校验重试」骨架不变。渲染步骤按 `mode` 开关分流两种画图模式。内容生成 agent 完全不改，照旧埋 `【配图指令:描述】` 占位符。

| 维度 | ASCII 模式（默认） | SVG 模式（开关开启） |
|---|---|---|
| role prompt | `prompts/diagram-ascii.md`（新） | `prompts/diagram-svg.md`（现有） |
| 画图规范 | `prompts/drawing-rules-ascii.md`（新） | `prompts/drawing-rules.md`（现有） |
| 输出提取 | `extractAsciiBlock`（新） | `extractSvg`（现有） |
| 校验 | `lintAscii`（新） | `lintSvg`（现有） |
| 写入飞书 | markdown 围栏代码块 ```` ``` ```` | `<whiteboard type="svg">…</whiteboard>` |

飞书文档以 markdown 建（`larkCreateDoc(md, "markdown", …)`），补图用 `larkUpdateStrReplace(url, 占位符, 内容)` 替换。ASCII 模式替换成围栏代码块，飞书渲染为等宽代码块，保证对齐。

## 组件与文件

### 1. 设置开关 `svgDiagram`（默认 false）

- `src/settingsStore.ts`：`AppSettingsSchema` 增加 `svgDiagram: z.boolean().default(false)`
- `web/lib/settingsTypes.ts`：`AppSettings` 接口增加 `svgDiagram: boolean`
- `web/components/SettingsModal.tsx`：增加一行开关「SVG 画图（关闭时使用字符图，更快更省）」，复用现有 `gate1Enabled` 的开关行样式
- `src/server.ts` + `src/cli.ts` 的 `buildDeps`：把 `appSettings.svgDiagram` 解析成 `mode: "svg" | "ascii"` 传入画图依赖

### 2. 模式分流：`src/diagrams.ts`

`DiagramDeps` 增加 `mode: "ascii" | "svg"` 字段（cli/server 从 `svgDiagram` 布尔映射，`NO_DIAGRAM` 逻辑不变）。`renderDiagram` 内根据 mode 选择：

- system prompt：`loadPrompt(mode === "svg" ? "diagram-svg" : "diagram-ascii") + "\n\n---\n\n" + loadPrompt(mode === "svg" ? "drawing-rules" : "drawing-rules-ascii")`
- 提取函数：`mode === "svg" ? extractSvg : extractAsciiBlock`
- 校验函数：`mode === "svg" ? lintSvg : lintAscii`
- 写入包装：`mode === "svg" ? \`<whiteboard type="svg">${out}</whiteboard>\` : \`\n\`\`\`\n${out}\n\`\`\`\n\``

重试反馈逻辑（把 lint issues 拼进 feedback 让 agent 修正）两模式共用。降级逻辑（超重试保留文字占位）不变。

### 3. 新增工具 `src/tools/ascii.ts`

```ts
// 从 agent 输出中提取围栏代码块内容；无代码块时抛错（触发重试）
export function extractAsciiBlock(text: string): string;

export interface AsciiLintResult { ok: boolean; issues: string[] }

// 务实版校验：
//  ① 扫禁用 Unicode 制表符/装饰符（┌─┐│├┼╔═╗●○◆▶▼ 等）
//  ② 行宽 ≤ 100（中文/全角字符按 2 列宽计算）
//  ③ 内容非空
// 不做 junction 对齐审计（太脆，靠 prompt 纪律）
export function lintAscii(ascii: string): AsciiLintResult;
```

字符宽度计算：CJK 统一表意文字、全角标点等按 2 列；其余按 1 列。用一个 `charWidth(codePoint)` 辅助函数。

### 4. 画图规范 `prompts/drawing-rules-ascii.md`（基于 jasnell，但更厚）

这是本方案的**质量命门**。因为我们没有 jasnell 的 `grid.py`/`verify.py` 外部脚本，
所有算列位、查对齐的负担都压在 prompt 上；加上中文标签（CJK 按 2 列）让对齐更难。
因此规范文件不能只是规则条目，**必须包含分图型的完整 few-shot 范例 + 反例 + 自检清单**。
预计成文 150~250 行。文件必须涵盖以下全部内容：

**A. 硬约束（违反 = 渲染失败/乱码）**
- 只允许字符集：`+ - | > < ^ v`；斜线 `/ \` 少用
- 禁用 Unicode 制表符/装饰符：`┌ ┐ └ ┘ ─ │ ├ ┤ ┬ ┴ ┼ ╔ ╗ ╚ ╝ ═ ║ ╭ ╮ ╰ ╯ ▶ ▼ ◀ ▲ ● ○ ◆ ◇` 一律禁止
- 中文/全角字符按 **2 列宽**计算（等宽字体下中文占 2 格），是对齐的头号杀手
- 宽度：默认 ≤ 80，最大 ≤ 100 列

**B. 三阶段工作流 PLAN → DRAW → VERIFY**
- PLAN：列出所有框和最长标签，算每个框宽 = 文字列数（中文×2）+ 左右各 1 空格 + 2 边框；建「列标尺」定位竖向元素
- DRAW：按列位落字，应用 Junction 规则
- VERIFY：逐项自检（见 D 节清单），不通过不产出

**C. 绘制约定**
- Junction 规则：每条 `|` 进出横线处必须在该列有 `+`
- 箭头贴边：`v ^ < >` 必须接触线或框边，无悬空箭头
- 框内文字左右各留 ≥ 1 空格；同层级框保持等宽
- 边标签（说明关系，如"调用""返回"）放连线旁

**D. VERIFY 自检清单**（代替缺失的 verify.py，逐条打勾）
- [ ] 无任何禁用 Unicode 字符
- [ ] 每行 ≤ 100 列（中文按 2 列数）
- [ ] 每个 `|` 的进出点在横线上都有 `+`
- [ ] 所有箭头都贴着线/框，无悬空
- [ ] 同层级框等宽、上下边框与内容行列对齐
- [ ] 中文标签的框宽已按 2 列/字算准

**E. 分图型完整范例（few-shot，每型 ≥ 1 个带中文标签、严格对齐的范例）**——这是最关键的部分：
- **横向流程**：框 + `--->` 箭头（示例见本 spec 正文，"用户请求→网关→服务"）
- **纵向流程/决策分支**：`|` + `v` 向下，分支用不同走向
- **分层架构**：多层横向框，层间竖箭头标注关系
- **时序图**：参与者竖泳道 + 横向消息箭头（含时间顺序）
- **关系/数据流图**：节点 + 有向连线，必要时加图例

每个范例都要展示**正确对齐后的成品**，让模型照抄结构。中文范例必须自己数准列宽。

**F. 反例（错误 → 修正）**：至少给 2 个常见错误的对照——① 用了 `┌─┐` 制表符（错）vs `+--+`（对）；② 中文标签按 1 列算导致边框错位（错）vs 按 2 列算准（对）。

**G. 产出**：只输出一个围栏代码块，块内是纯图，块外不要任何解释文字。

### 5. 角色 prompt `prompts/diagram-ascii.md`（新）

与 `diagram-svg.md` 平行的角色定义，说明「你是字符图绘制者，收到配图指令和上下文，产出一个围栏代码块的 ASCII 图」。规范细节交给 `drawing-rules-ascii.md`。

### 6. 作图状态可见（顺带修复问题反馈 #5）

`patchDiagrams` 的进度回调改成 mode 感知，且成功路径也 push 事件：

- 生成开始：`step_start`，label = `${modeLabel}：${instruction前40字}`（modeLabel = `字符作图` / `SVG 作图`）
- 写入飞书时：通过 `onProgress` 更新为 `写入飞书：${instruction前40字}`
- 完成：`progress`（同一 label 收尾，被 StepsSidebar 标记 ✓）

`server.ts` 的 `patchDiagrams` 调用处补齐 `onProgress`/`onStart` 回调发对应 `step_start`/`progress` 事件（当前只有 `onError`）。`DiagramSpec` 的进度事件需带稳定 label，使 StepsSidebar 每张图独立成节点（配合已修复的去重逻辑）。

### 7. 标签与配置

- 保留 role id `diagramSvg` 不变（避免 `agents.config.json` / 历史 step 记录 churn），仅运行时 label 改为 mode 感知
- `AGENT_ROLE_LABELS` / `ROLE_LABEL` 里 `diagramSvg` 显示名由「SVG 作图」改为「作图」（mode 中性）
- `agents.config.json` 的 `diagramSvg` 配置保持（effort medium / maxTokens 8000 / thinking disabled）；实现后若 ASCII 对齐质量不足，再评估是否给该角色开 adaptive thinking（PLAN 阶段受益）

## 数据流

```
内容生成 agent 产出 markdown（含【配图指令:描述】）
        │
        ▼
publish() 建飞书文档（markdown），立即回传 URL
        │
        ▼
patchDiagrams（fire-and-forget）
        │  按 mode 分流
        ├── 并行：每条 spec → renderDiagram
        │     │  PLAN/DRAW/VERIFY（ASCII）或 SVG 生成
        │     │  extractAsciiBlock/extractSvg → lintAscii/lintSvg
        │     │  失败→feedback重试（≤maxRetries）→仍失败降级保留占位
        │     ▼
        └── 串行：updateChain 逐个 larkUpdateStrReplace 写回飞书
              （ASCII→代码块 / SVG→whiteboard）
```

## 错误处理与降级

- lint 超重试仍失败：保留原文字占位，不阻断整篇文档（同现有）
- agent 未输出有效块：feedback 提示后重试（同现有）
- 飞书 `larkUpdateStrReplace` 对围栏代码块的解析：实现时先实测验证一次（参考内存 `feishu-doc-gotchas`），若代码块无法正确解析成飞书代码块，退化方案是用飞书 XML `<code>` block 语法

## 测试

- `lintAscii` 单测：① 含禁用 Unicode 字符 → fail ② 超 100 列 → fail ③ 中文标签按 2 列计算正确 ④ 正常图 → ok ⑤ 空内容 → fail
- `extractAsciiBlock` 单测：① 带语言标注围栏 ② 裸围栏 ③ 无代码块 → 抛错
- 模式分流单测：mock `runRole`，验证 mode=ascii 时用 `diagram-ascii` prompt + `lintAscii` + 代码块包装；mode=svg 时用原路径
- 设置开关单测：`svgDiagram` 默认 false，save/load 往返正确

## 非目标（YAGNI）

- 不做 junction 对齐的代码级审计（v1 靠 prompt）
- 不改内容生成 agent 的配图指令格式
- 不改 SVG 模式的现有行为（仅从"总是启用"变为"开关控制"）
- 「创作状态全面可见」的大课题不在此 spec 内，仅顺带做画图这一环的状态可见
