# Plan 2a — 多 agent 流水线 + 两道人工门 + 飞书原生块渲染

> 状态:✅ 已实现(见 git 提交 d070bc4..449c0d7)。本文为归档,供回溯。

## Context(为什么做这个)

Plan 1 已端到端跑通:命令行输入知识点 → 单个"内容生成"agent(走公司网关 claude-opus-4-8)→ 写飞书返回 URL。但有两个明显缺口:

1. **飞书文档是"一坨纯文本"**:`markdownToDocXml` 把整篇 markdown 塞进一个 `<p>`、换行转 `<br/>`,标题/代码/表格/列表都不渲染成飞书原生块。
2. **没有设计文档说的流水线**:只有 1 个 agent,缺"问题分析→内容组织→内容生成→内容审核"的多步链路,也没有两道人工确认门。

Plan 2a 在骨架上补齐**主干**:多 agent 流水线 + 两道门(展示+文字反馈迭代)+ 飞书原生块渲染(改用 `--doc-format markdown` 导入)。

**明确不在 2a**(留后续):联网搜索、画图(mermaid/SVG,必然用 XML)、飞书查重去重合并(把增量插入旧文档)。

## 已定决策(用户拍板)

- 范围切成 2a/2b 两步,本计划只做 2a。
- 两道门交互 = **展示 + 文字反馈迭代**:终端打印大纲/骨架,回车通过,或输入自然语言修改意见→对应 agent 据此重新生成→再展示,循环到通过。
- 飞书渲染 = **生成 Markdown → `--doc-format markdown` 导入**(标题/代码块/表格/列表/引用会渲染成原生块)。

## 架构变化总览

| 文件 | 变化 |
|---|---|
| `src/tools/lark.ts` | 支持 `--doc-format markdown`,markdown 内容经 **stdin** 喂入;`CliRunner` 增加 stdin 参数 |
| `src/io.ts` | 新增:readline 门交互(复用单实例,可注入 fake 测试) |
| `src/orchestrator.ts` | 核心改造:`runSkeleton` → `runPipeline`(4 agent + 两道门 + 审核打回循环) |
| `prompts/question-analysis.md`、`content-organization.md`、`content-review.md` | 新增 3 个角色 prompt |
| `agents.config.json` | `contentReview.model` 对齐网关真实 id `claude-haiku-4-5-20251001` |
| `src/cli.ts` | 装配新流水线 + 真实 readline asker;`GATE_AUTOPASS` / `LARK_DRY_RUN` 开关 |

## Task 拆解(均已完成,先失败测试再实现,每 Task 一次提交)

1. **lark.ts 支持 markdown 导入(stdin)**:`buildCreateDocArgs(format)` → `docs +create --doc-format <fmt> --content - --as user`;`defaultRunner` 用 spawn 写 stdin;`larkCreateDoc(content, format="markdown", runner)`。
2. **三个新角色 prompt**:问题分析(粗粒度一级大纲+意图)、内容组织(三级骨架+表达形式菜单)、内容审核(对照骨架检查清单,输出 PASS/FAIL)。
3. **门交互模块 src/io.ts**:`Asker = (title, content) => Promise<string>`(空=通过,非空=修改意见);`createReadlineAsker()` 复用单 rl 实例并暴露 `.close()`。
4. **orchestrator runPipeline**:问题分析→门1→组织→门2→生成→审核打回(≤reviewMaxRetries)→publish;`iterateWithGate` 复用两道门;全依赖注入(runRole/gate/publish/loadPrompt)。
5. **config 对齐**:contentReview 模型 id 改 `claude-haiku-4-5-20251001`;同步测试桩。
6. **cli 装配**:按角色 `resolveAgentConfig` 建 `runRole`;publish 走 `larkCreateDoc(md, "markdown")`;真实 readline;`GATE_AUTOPASS=1` 自动过门、`LARK_DRY_RUN=1` 只打印。
7. **端到端验证**:真实走完流水线并写飞书,读回确认为原生块(标题/代码/表格/列表)。

## 完成标准(已达成)

- [x] `npm test` 全绿(27)、`npm run typecheck` 无错
- [x] 流水线跑通:问题分析→门1→组织→门2→生成→审核→写飞书
- [x] 两道门:回车通过 + 文字反馈重跑上游
- [x] 飞书文档为**原生块**排版(标题/代码/表格/列表)
- [x] 审核 FAIL 打回重生成

## 实现中发现的坑(已修)

- 大 `maxTokens` 下 SDK 拒绝非流式请求(Plan 1 已用 `.stream().finalMessage()`)。
- readline 每道门新建/关闭会导致**管道 stdin 下第二道门读不到输入**(进程空转退出)→ 改为复用单个 rl 实例 + `.close()`;并加 `GATE_AUTOPASS=1` 供无人值守验证。
