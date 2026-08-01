# Plan 2c — 画图:agent 生成自包含 SVG 插进飞书画板

## Context(为什么做这个)

Plan 2a 让飞书文档有原生块排版,2b 加了联网时效性。但内容里的 `【配图指令:...】` 仍是纯文本占位。设计文档惊艳维度③是"手绘级图"。

**技术路线经 spike 定为:agent 直接生成自包含 SVG → 校验 → 插飞书 `<whiteboard type="svg">`。**

**为什么不用 archify**(spike 结论):archify 画质虽好,但它输出的 SVG 有 136 个 class、样式全在 HTML 外部 `<style>` 里,抽出来样式全丢;进飞书画板渲染成一坨黑块(附录A 的 pattern 也不支持);唯一可行是"HTML 整体截图成 PNG",但需装 headless 浏览器(~150MB)、且出来是静态不可编辑位图。**性价比不划算,弃用。**

**为什么选自包含 SVG**:飞书画板**原生支持** `<whiteboard type="svg">`(spike 实测:自包含、内联样式的干净 SVG 渲染正确);矢量、**可编辑**、视觉最自由(最贴合"手绘级图"),agent 直接产文本、**零外部依赖/渲染器**。代价:agent 要自己算坐标布局,复杂图易乱 —— 靠 drawing-rules 严格约束 + 校验兜底。

## 已定决策(用户拍板)

- 画图主路线 = **agent 生成自包含飞书兼容 SVG**(不用 archify、不用 draw.io)。
- 顺序:画图(本计划)→ ② 查重去重合并 → ③ Distiller。

## 集成思路(总览)

```
内容生成产出的 markdown(含【配图指令:X】占位)
  → 解析出所有配图指令
  → [SVG 生成 agent] 每条指令 + 上下文 → 产出自包含飞书兼容 SVG(遵 drawing-rules)
  → 校验(svgLint):自包含? 无禁用元素(pattern/mask/clipPath/foreignObject/非阴影filter)? 有 viewBox? text 用 <text>?
       失败 → 把校验诊断喂回 agent 重生成(≤2 轮)
  → 插飞书:docs +update 把占位段落替换成 <whiteboard type="svg">SVG</whiteboard>
       (或 create 时混入;定位靠 block_id / str_replace)
  → 校验两轮仍不过 → 保留原【配图指令】文字占位,不阻断整篇
```

(下面分 Task,先失败测试再实现,末尾 git 提交)

> 注:上一轮探索写的 `src/tools/archify.ts` + 测试随本计划废弃(archify 弃用),Task 1 一并 git rm。

---

## Task 1: SVG 校验/提取工具 src/tools/svg.ts

纯函数,可精确单测(不碰网络):
- `extractSvg(text)`:从 agent 输出(可能裹着 ```svg 围栏或说明文字)里提取 `<svg>…</svg>`;取不到抛清晰错误。
- `lintSvg(svg)`:校验飞书画板兼容性,返回 `{ ok, issues: string[] }`:
  - 必须有 `viewBox`
  - **禁用元素**:`pattern` / `mask` / `clipPath` / `foreignObject` / 非阴影 `filter`(命中即 issue,附元素名)
  - **自包含检查**:不得出现 `class=`(飞书画板不加载外部 CSS,样式必须内联到元素属性/`style=`);无外部字体引用
  - 诊断文本要具体(哪个元素、为什么),供喂回生成 agent 修正

**失败测试要点**(`tests/svg.test.ts`):extractSvg 提取围栏内/裸 svg、无 svg 抛错;lintSvg 命中 pattern/mask/foreignObject/class、缺 viewBox 各出 issue;干净 svg 返回 ok。

**验证**:`npx vitest run tests/svg.test.ts` 全绿。commit:`feat: SVG 校验/提取工具 + 移除废弃的 archify 工具`

---

## Task 2: 作图规范 drawing-rules + SVG 生成角色

- `prompts/drawing-rules.md`(作图规范,单一真相源):
  - **飞书兼容硬约束**:自包含(样式全内联,禁用 class/外部 CSS/外部字体)、必带 viewBox、禁用 pattern/mask/clipPath/foreignObject/非阴影 filter、文字用 `<text>` 且留足宽度(CJK≈1em/字)、箭头用 `<polygon>` 手绘、连线用正交折线 `<polyline>`。
  - **借鉴 archify/Cocoon 的审美**:清爽配色板(浅色底 + 一组协调的节点色,给出 hex)、圆角卡片(rect rx)、层次分明的字号、留白与对齐、正交箭头、可选浅网格背景(用平铺 `<line>` 而非 pattern)。
- `prompts/diagram-svg.md`(SVG 生成角色):输入一条 `【配图指令:X】` + 上下文 → 产出**一个自包含飞书兼容 SVG**(遵 drawing-rules);若收到校验诊断则据此修正重出。
- `src/types.ts`:`AgentRole` 加 `"diagramSvg"`;`agents.config.json` 加该角色;同步 `src/cli.ts` 的 `ROLE_LABEL` 与 `tests/config.test.ts`。

**失败测试要点**:`tests/prompts.test.ts` 加载 `drawing-rules`/`diagram-svg` 含关键词(如"viewBox""内联""自包含");config 覆盖新角色。

**验证**:相关单测全绿。commit:`feat: 作图规范(飞书兼容+借鉴审美)+ SVG 生成角色`

---

## Task 3: 插图编排 src/diagrams.ts

新增 `src/diagrams.ts`(依赖注入,可测),orchestrator 在内容生成后、publish 前调用:
- `extractDiagramSpecs(markdown)`:纯函数,解析所有 `【配图指令:...】`(指令文本 + 在文中位置)。**先写单测**。
- `renderDiagram(spec, deps)`:SVG 生成 agent 产出 → `extractSvg` → `lintSvg`;有 issue 则把诊断喂回 agent 重出(≤2 轮);两轮仍不过 → 返回 null(降级)。
- 组装:把每条配图指令的占位段落,替换成 `<whiteboard type="svg">SVG</whiteboard>`。落地方式二选一(实现时定):
  - (a) 生成阶段就把 SVG 内联进 markdown 交给 publish(markdown 模式下 XML 标签仍生效——见 lark skill);或
  - (b) markdown 先建文档,再用 `docs +update` 的 `str_replace` 把 `【配图指令:X】` 占位替换成 whiteboard XML。
- 全部注入(runRole / lint / lark),测试用 fake。降级(null)时保留原文字占位,不阻断整篇。

**失败测试要点**(`tests/diagrams.test.ts`):`extractDiagramSpecs` 多情况;`renderDiagram` 用 fake 验证"lint 失败→喂诊断重试→通过";两轮失败返回 null(降级)。

**验证**:`npx vitest run tests/diagrams.test.ts` + 全量 `npm test`。commit:`feat: 插图编排(配图指令→SVG生成→校验→插飞书)`

---

## Task 4: cli 装配 + 端到端验证

- `src/cli.ts`:把 `diagramSvg` 角色接入 `runRole`;orchestrator/publish 串上插图编排;`lintSvg` 注入。开关 `NO_DIAGRAM=1` 跳过画图。
- 端到端:`GATE_AUTOPASS=1 npm start -- "<带图友好主题,如 事件循环 / TCP 三次握手>"`:
  - 内容里的 `【配图指令】` 被替换成飞书画板 SVG
  - 打开飞书 URL:图能正常渲染且可编辑,风格接近样例
  - 某图校验两轮不过 → 保留文字占位,不阻断整篇(log 提示)

**验证**:`npm test` 全绿 + `npm run typecheck` + 真实端到端出一篇带图文档。commit:`feat: CLI 接入 SVG 画图 + 端到端`

---

## 完成标准(Plan 2c Done)

- [ ] `npm test` 全绿、`npm run typecheck` 无错
- [ ] `src/tools/svg.ts` 校验/提取有测试覆盖;废弃的 archify 工具已移除
- [ ] 一篇文档里的配图指令能变成飞书里**可编辑的 SVG 画板**,风格接近样例
- [ ] 出图失败优雅降级(保留文字占位,不阻断整篇)

## 下一步(按 1→2→3,本计划是①)

- **② 查重去重合并**:`drive +search` 找旧文档 → `block_insert_after` 把增量插进旧文档锚点(设计文档"问·存·改"闭环)。
- **③ Plan 3 / Distiller**:门反馈 → 蒸馏规则 → 批准 → 写回 prompts + commit。
