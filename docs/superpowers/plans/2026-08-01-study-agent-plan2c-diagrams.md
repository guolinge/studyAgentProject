# Plan 2c — 画图:用 archify 把【配图指令】变真图插进飞书

## Context(为什么做这个)

Plan 2a 让飞书文档有了原生块排版,2b 加了联网时效性。但内容里的 `【配图指令:...】` 仍是纯文本占位。设计文档的惊艳维度③是"手绘级图",而我们自己生成 SVG 坑多(设计文档附录A:飞书画板不支持 pattern/clipPath/mask/非阴影 filter,mermaid 标签要清洁化)。

**用 archify**(GitHub tt-a1i/archify)——一个独立 Node CLI(`archify/bin/archify.mjs`),强约束生成管线:输入 JSON 图描述 → schema 校验 → 布局规则 → 渲染/路由校验 → 原子交付,失败给机器可读 JSON 诊断、限两轮修正。输出自包含 HTML,可导出 **SVG / PNG**,支持 5 类图(Architecture / Workflow / Sequence / DataFlow / Lifecycle)。把"画质 + 校验"交给它的管线,我们只负责"配图指令 → archify JSON → 调用 → 取图 → 插飞书"。

## 已定决策(用户拍板)

- 画图用 **archify** 生成管线(不自己硬写 SVG/mermaid)。
- 先做画图,做完再查重去重合并、再 Distiller(用户定的 1→2→3 顺序)。

## 集成思路(总览)

```
内容生成产出的 markdown(含【配图指令:X】占位)
  → 解析出所有配图指令
  → [图规划 agent] 每条指令 → 判定图类型(5类之一)+ 产出 archify JSON
  → archify validate --json(失败把诊断喂回 agent 修正,≤2 轮)
  → archify deliver 导出 SVG(优先)/ PNG
  → 插飞书:SVG → <whiteboard type="svg">(可编辑,受飞书约束);
            退回 → docs +media-insert 插 PNG 图片(一定能显示,不可编辑)
  → 用画板/图片替换掉原【配图指令】占位段落
```

(下面分 Task,先做不确定性最高的 spike,再展开实现;每 Task 先失败测试再实现、末尾 git 提交)

---

## Task 1: 技术验证 Spike(先做——不确定性最高,后续 Task 依赖它)

**目标**:摸清 archify 怎么装/怎么调、5 类图的 JSON schema、导出的图能否进飞书。**本 Task 是探索,无自动化测试,产出一份结论笔记。**

步骤:
1. **装 archify**:试 `npx skills add tt-a1i/archify -g`;若不便则 clone 仓库 / 用 `archify.zip`。确认 `node <path>/bin/archify.mjs --help` 可跑。
2. **摸 schema**:看 `archify/schemas/` 里 5 类图(architecture/workflow/sequence/dataflow/lifecycle)的 JSON 结构;跑 `examples/` 样例过 `validate <type> <json> --json`。
3. **跑通生成**:手写(或改样例)一个 workflow JSON → `validate --json`(看诊断格式)→ `deliver`/`preview` 导出,拿到 **SVG 和 PNG** 两种产物。
4. **试插飞书**(关键分叉,先 SVG 后 PNG):
   - SVG:`lark-cli docs +create --doc-format xml --content '<title>t</title><whiteboard type="svg"><svg.../></whiteboard>'`(stdin),看是渲染成**可编辑画板**还是降级内嵌图片。
   - PNG:先建文档再 `lark-cli docs +media-insert --doc <url> --file diagram.png`(先 `lark-cli skills read lark-doc references/lark-doc-media-insert.md`)。
5. **结论**:确定集成路径(SVG 画板优先 / PNG 图片兜底)、archify 确切命令与输出路径、schema 要点。写进本计划附录或 spike 笔记,后续 Task 据此细化。

**验证**:能在飞书看到一张 archify 生成的图。commit:`spike: 验证 archify 生成 + 飞书插图路径`(含结论笔记)

---

## Task 2: archify 调用工具 src/tools/archify.ts

延续 `src/tools/lark.ts` 的模式(纯函数构造 argv + 注入 runner,可 mock):
- `buildValidateArgs(type, jsonPath)` / `buildDeliverArgs(type, jsonPath, outPath, quality?)` —— 纯函数
- 复用/仿照 lark 的注入型 `CliRunner`
- `archifyValidate(...)`:跑 validate,解析 `--json` 诊断(pass/fail + 规则码 + 证据)
- `archifyDeliver(...)`:生成产物,返回输出文件路径
- 具体 argv/输出结构**以 Task 1 spike 结论为准**

**失败测试要点**(`tests/archify.test.ts`):argv 构造断言;mock runner 返回 validate JSON → 断言解析出 pass/fail 与诊断;deliver 路径解析。

**验证**:`npx vitest run tests/archify.test.ts` 全绿。commit:`feat: archify 调用工具(validate/deliver,可注入 runner)`

---

## Task 3: 作图规范 + 图规划角色 prompt

- `prompts/drawing-rules.md`(作图规范,单一真相源):5 类图选型指引(什么内容配什么图)、archify JSON 写法要点、飞书画板/图片的坑(附录A + spike 结论)。
- `prompts/diagram-planning.md`(图规划角色):输入一条 `【配图指令:X】` + 上下文 → 判定图类型 → 产出合法 archify JSON。附上 drawing-rules。
- `src/types.ts`:`AgentRole` 增加 `"diagramPlanning"`;`agents.config.json` 加该角色。
- 同步更新 `tests/config.test.ts`(若断言角色集合)、`src/cli.ts` 的 `ROLE_LABEL`。

**失败测试要点**:`tests/prompts.test.ts` 加载 `drawing-rules`/`diagram-planning` 含关键词;config 覆盖新角色。

**验证**:相关单测全绿。commit:`feat: 作图规范 + 图规划角色 prompt`

---

## Task 4: 插图编排 src/diagrams.ts

新增 `src/diagrams.ts`(依赖注入,可测),orchestrator 在内容生成后调用:
- `extractDiagramSpecs(markdown)`:纯函数,解析所有 `【配图指令:...】`(文本 + 位置)。**先写这个的单测**。
- `renderDiagram(spec, deps)`:图规划 agent 产 JSON → `archifyValidate`(失败喂诊断重出,≤2 轮)→ `archifyDeliver` 出图 → 返回 SVG/PNG 路径或 XML 片段。
- 插飞书:按 spike 结论,SVG 走 `<whiteboard>`(create 混入 XML,或 create 后 `docs +update` 用 `block_replace`/`str_replace` 换占位);PNG 走 `docs +media-insert`。
- 全部注入(runRole / archify / lark),测试用 fake。

**失败测试要点**(`tests/diagrams.test.ts`):`extractDiagramSpecs` 多情况;`renderDiagram` 用 fake 验证"validate 失败→喂诊断重试→deliver"循环;插图调用顺序。

**验证**:`npx vitest run tests/diagrams.test.ts` + 全量 `npm test` 全绿。commit:`feat: 插图编排(配图指令→archify→插飞书)`

---

## Task 5: 端到端手动验证

`GATE_AUTOPASS=1 npm start -- "<带图友好的主题,如 事件循环 / TCP 三次握手>"`:
- 流水线正常走完,`【配图指令】` 被替换成真图
- 打开飞书 URL:能看到 archify 生成的图(画板或图片),排版正常
- 某张图 validate 两轮仍失败:降级为保留文字占位(不阻断整篇),并 log 提示

> 若因 archify/飞书失败,记录并报告;单测已保证编排逻辑正确,此步是真实联调。

---

## 完成标准(Plan 2c Done)

- [ ] `npm test` 全绿、`npm run typecheck` 无错
- [ ] archify 装好、CLI 可调,`src/tools/archify.ts` 有测试覆盖
- [ ] 一篇文档里的配图指令能变成飞书里的真图
- [ ] 出图失败能优雅降级(保留文字占位,不阻断整篇)

## 下一步(本计划不做,按 1→2→3 顺序)

- **② 查重去重合并**:`drive +search` 找旧文档 → `block_insert_after` 把增量插进旧文档锚点(设计文档"问·存·改"闭环)。
- **③ Plan 3 / Distiller**:门反馈 → 蒸馏规则 → 批准 → 写回 prompts + commit。
