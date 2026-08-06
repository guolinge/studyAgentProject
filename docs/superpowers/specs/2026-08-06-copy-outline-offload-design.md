# 门2「复制大纲」offload + prompt 修复 设计

**日期：** 2026-08-06
**状态：** 已批准，待写实现计划

## 目标

在门2（内容组织后）新增「复制大纲」分支：把本系统「内容生成 + 作图」的全部指令连同骨架打包成一个自包含 bundle 复制到剪贴板，用户粘贴到公司免费的 AI 中台生成完整文档；本系统同时建好空白飞书文档（目录/标题已定）并入索引。目的是把最贵的长文生成环节 offload 出去，本系统只做便宜的分析/研究/组织/文档管理。

顺带修两个已发现的 prompt 问题（它们正好是 bundle 复用的 prompt）。

## 背景

- 一次完整流水线里「内容生成」是 token 大头。用户原本就习惯用 AI 中台问答，offload 给中台对用户零成本。
- 用户实测发现：门2 骨架里的「体量」标注（如"约 380 字"）没有约束到实际生成——根因是 `content-generation.md` 通篇没提体量。
- `drawing-rules-ascii.md` 的 B~G（PLAN/DRAW/VERIFY + 范例）在无 verify 脚本兜底时没换来对齐，只是每次画图白耗 token。

---

## 一、prompt 修复（服务正常流水线，也被 bundle 复用）

### 修复 #2：`prompts/drawing-rules-ascii.md` 精简到只留 A

重写为只含硬约束，删掉 B~G：
- 只允许结构字符 `+ - | > < ^ v`（斜线少用）
- 禁用 Unicode 制表符/装饰符 `┌ ┐ └ ┘ ─ │ ├ ┤ ┬ ┴ ┼ ╔ ╗ ╚ ╝ ═ ║ ╭ ╮ ╰ ╯ ▶ ▼ ◀ ▲ ● ○ ◆ ◇`
- 结构字符 vs 文字标签的区分保留（标签可用中文/英文/数字，中文按 2 列宽计算）
- 宽度 ≤ 100 列
成文控制在 ~30 行内。

### 修复 #3：体量纪律

- `prompts/content-generation.md` 增加一节「## 体量纪律」：逐节对齐骨架的体量估算；某节标"约 N 字"就要写到接近 N 字，篇幅不足时靠展开推导 / 补充例子 / 增加边界讨论补足，不许压缩内容凑数也不许敷衍偏短。
- `prompts/content-review.md` 增加一条检查项：抽查各节篇幅是否明显低于骨架体量估算，明显偏小则判 FAIL 并指出是哪节，交由打回 loop 重生成。

---

## 二、门2「复制大纲」功能

### 交互流程

门2 展示骨架时，除现有「通过 / 提交意见」，多一个 **「复制大纲」** 按钮：

```
内容组织 → 门2（展示骨架）
              ├── 通过 ↵        → 继续内容生成 + 审核（原路径，本系统跑）
              ├── 提交意见       → 门迭代重跑内容组织（原路径）
              └── 复制大纲(新)   → 剪贴板写入 bundle + 发哨兵信号
                                    → 后端跳过生成/审核，建空白文档 + 入索引 + 结束
```

用户随后：把 bundle 粘到 AI 中台 → 拿到带图完整文档 → 粘进空白飞书文档。

### bundle 内容（后端在发门2事件时组装，随事件带给前端）

按顺序拼成一段自包含文本：
1. **总 framing**：「请扮演资深技术作者，为前端工程师（懂后端、目标架构师）按下面的骨架、方法论和规则，输出一篇完整的 Markdown 讲解文档。」
2. **原始问题**（userInput）
3. **联网研究资料**：若 `researchMemo` 非空，一并带上（让中台用最新事实）；为空则跳过该段
4. **已确认的骨架**（skeleton，含体量标注）
5. **内容生成方法论**（`content-generation.md` 全文）+ **追加覆盖指令**：「配图处理（覆盖上文）：本任务没有后续画图环节，遇到需要图的地方请直接用字符图画进围栏代码块（规范见下），不要输出 `【配图指令】` 占位符。」
6. **风格规则**（`style-rules.md` 全文）
7. **字符画图规范**（修复后的精简 `drawing-rules-ascii.md`）
8. **体量纪律**：一句强调「严格按骨架各节体量写足」（与 #3 一致；可直接复用 content-generation.md 里那节，不必重复注入——见下方"去重说明"）

**去重说明**：第 8 点的体量纪律已包含在第 5 点的 content-generation.md 内（#3 修复后），故 bundle 不单独再拼一次，避免冗余。bundle 实际拼接段为 1-7。

---

## 三、技术落点

### 组装函数（纯函数，可单测）

`src/outlineBundle.ts`（新）：
```ts
export interface BundleParts {
  question: string;      // 原始问题
  research: string;      // 联网研究 memo，可为空
  skeleton: string;      // 门2 确认/展示的骨架
  generation: string;    // content-generation.md 全文
  styleRules: string;    // style-rules.md 全文
  drawingRules: string;  // 精简 drawing-rules-ascii.md 全文
}
export function buildOutlineBundle(p: BundleParts): string;
```
按上面 1-7 顺序拼接；`research` 为空时跳过该段；段间用清晰的 `\n\n## ===== <段名> =====\n\n` 分隔，便于中台阅读。覆盖指令（配图处理那句）拼在 `generation` 段之后、`styleRules` 段之前。

### 哨兵信号 + orchestrator 分支

- 常量 `COPY_OUTLINE_SIGNAL = "__COPY_OUTLINE__"`（放 orchestrator 或共享常量）。
- 门2 不能用通用 `iterateWithGate`（它只认""通过/非空重跑）。改为在 orchestrator 里对门2 单独处理：
  - 跑内容组织得到 skeleton
  - 循环调用 `deps.gate("门2 · 确认骨架", skeleton)`：
    - 返回 `""` → 通过，跳出，走后续内容生成
    - 返回 `COPY_OUTLINE_SIGNAL` → 组装 bundle、建空文档、入索引、返回 `{ kind: "outline_copied", url }`
    - 返回其它非空 → 视为修改意见，重跑内容组织（保持原门迭代语义）
- 新增 `deps.publishBlank?(title, placement): Promise<string>`（或复用 publish 传空内容标记）——建仅含 `# 标题` 的空白文档，返回 URL。设计选择：**新增 `publishBlank`**，语义清晰、不污染 publish 的画图逻辑。

### PipelineResult 新类型

`PipelineResult` 增加：`| { kind: "outline_copied"; url: string; bundle: string; feedbacks: GateFeedback[] }`。
（bundle 也回传，便于 CLI 场景打印/落盘；web 场景 bundle 已随门2事件给过前端。）

### GateEvent 加字段（web）

- `GateEvent` 增加可选 `bundle?: string`。后端仅在**门2**的 gate 事件里填它。
- 前端 `GateViewer`：当 `event.bundle` 非空时，额外渲染「复制大纲」按钮；点击 → `navigator.clipboard.writeText(event.bundle)` → `onSubmit(COPY_OUTLINE_SIGNAL)`。
- 前端提交哨兵后，正常收到 `doc_created`（空文档 URL）+ `done` 事件。

### gate 签名扩展 + orchestrator 组装时机

- `Asker` gate 类型扩展为 `(title: string, content: string, bundle?: string) => Promise<string>`。
- orchestrator 在门2 循环里：先 `buildOutlineBundle(...)` 组装 bundle（用 loadPrompt 取三份 prompt + researchMemo + skeleton + userInput），再 `gate("门2 · 确认骨架", skeleton, bundle)`。skeleton 每次因意见重跑而变，bundle 随之重算。
- server 的 gate 把 bundle 塞进 `GateEvent`；cli 的 gate 忽略 bundle 参数。

### server / cli 装配

- 两端都新增 `publishBlank(title, placement): Promise<string>` 注入 orchestrator：建仅含 `# 标题` 的空白 markdown 文档（placement.type=new 时先建文件夹），发 `doc_created`，返回 URL。与 `publish` 平行但不含画图。
- 两端都要处理新 `PipelineResult.kind === "outline_copied"`：
  - server：doc_created 已在 publishBlank 内发过；补发 `done`。
  - cli：把 bundle 写到 `./outline-bundle.md` 并打印路径 + 空文档 URL，方便手动复制。
- cli 的 gate 识别信号：用户在门2 输入 `copy` 或 `复制大纲` → 返回 `COPY_OUTLINE_SIGNAL`（其余非空仍为修改意见）。

---

## 四、边界与影响面

- dedup / 拆分 / patch_diagrams 分支都在门2**之前**，不受影响。
- offload 分支不跑内容生成/审核/画图，本次 run token 只花在 分析+研究+组织。
- 空文档已入索引（用户选择 A）：日后查重/检索能命中；短暂空窗（贴内容前）可接受。
- researchMemo 为空（NO_SEARCH 或研究失败）时 bundle 跳过研究段，其余不变。
- 修复 #2 后 drawing-rules-ascii.md 变短，正常流水线的 SVG/字符画图 role 仍照常加载它（无破坏）。

## 五、测试

- `buildOutlineBundle` 单测：① research 非空时含研究段、为空时跳过 ② 段序正确（framing→问题→研究→骨架→生成方法论→覆盖指令→风格→画图规范）③ 覆盖指令出现在 generation 与 styleRules 之间 ④ 骨架/问题原样嵌入。
- orchestrator 单测：mock gate 在门2 返回 `COPY_OUTLINE_SIGNAL` → 断言不调用 contentGeneration/contentReview、调用了 publishBlank + updateIndex、返回 `kind:"outline_copied"`；另一用例 gate 返回 `""` → 走原生成路径（回归）。
- content-generation / content-review / drawing-rules-ascii 为 prompt 文件，无单测，靠人工与既有流水线验证。

## 六、非目标（YAGNI）

- 不在 offload 分支做查重合并（merge 需要生成增量内容，正是被 offload 的部分；本分支只建新文档）。
- 不实现「粘贴回填自动检测/校验」——用户手动粘贴。
- 不改门1 及其之前的任何逻辑。
- 不做 bundle 的多模型适配/裁剪（先出一版通用 bundle）。

