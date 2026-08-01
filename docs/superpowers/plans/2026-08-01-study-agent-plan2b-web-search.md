# Plan 2b — 联网搜索:Tavily 结果顺流水线下传

## Context(为什么做这个)

Plan 2a 的流水线跑通了,但答案完全依赖模型内部知识,缺**时效性**和**事实依据**(设计文档痛点:过时方案、缺最新主流实践)。设计文档 7.2 明确:联网搜索只在必要处**搜一次**,结果作为上下文顺流水线往下传,后续 agent 按需用,不重复搜。

之前误判"网关做不了"——实为路径错了。经实测,公司网关的 **Tavily 透明代理**可用:

```
POST https://llm-proxy.futuoa.com/tavily/api-server/search
Authorization: Bearer <统一key>
{"query":"...", "max_results":N, "include_answer":true}
→ { answer: "AI 摘要", results: [ { url, title, content, score }, ... ] }
```

100% Tavily 标准格式。把它接进"问题分析"阶段,搜一次、下传给内容组织/生成,让成稿能引用最新事实并标注来源。

## 已定决策(用户拍板)

- Plan 2b = **联网搜索**(Tavily),比画图简单、风险低,先做。
- 画图(archify 管线)挪到后面独立 plan(spike + 集成)。

## 集成思路(总览)

```
用户输入 → [问题分析] 产出一级大纲/意图
  → [联网搜索一次] 用 输入(+大纲话题)作 query 调 Tavily → 拿 answer + results
  → 把搜索结果格式化成一段上下文(摘要 + 带 url 的来源清单)
  → 顺流水线拼进 内容组织 / 内容生成 的输入
  → 生成时可引用最新事实、标注来源与时效;审核照旧
```

要点:搜一次(不在每个 agent 各搜一遍);可加开关跳过(如离线/简单概念);搜索失败要**优雅降级**(不阻断流水线,退回纯模型作答)。

(下面分 Task,先失败测试再实现,末尾 git 提交)

---

## Task 1: Tavily 搜索工具 src/tools/tavily.ts

延续项目"纯函数 + 注入执行器"的可测模式(类似 `src/tools/lark.ts`):
- `buildSearchRequest(query, opts?)`:纯函数,返回 `{ url, body }`(url = `${base}/tavily/api-server/search`,body 含 query/max_results/include_answer)
- `HttpPost = (url, headers, body) => Promise<string>`:注入型执行器;真实实现用 Node 原生 `fetch`,测试传 fake
- `tavilySearch(query, deps)`:调用后解析响应 → 返回结构化 `{ answer: string, results: {title,url,content,score}[] }`
- `formatSearchContext(result)`:纯函数,把结果拼成给下游 agent 的一段中文上下文(摘要 + 带 url 的来源清单),便于断言
- base url 与 key 从参数/env 注入(`ANTHROPIC_BASE_URL` 同源 + 统一 key)

**失败测试要点**(`tests/tavily.test.ts`):
- `buildSearchRequest` 断言 url 后缀 `/tavily/api-server/search`、body 含 query
- `tavilySearch` 用 fake httpPost 返回样例 JSON → 断言解析出 answer 与 results
- `formatSearchContext` 断言输出含标题与 url
- httpPost 抛错时 `tavilySearch` 的处理(抛出可被上层降级捕获)

**验证**:`npx vitest run tests/tavily.test.ts` 全绿。commit:`feat: Tavily 搜索工具(透明代理路径,可注入 httpPost)`

---

## Task 2: 搜索结果注入流水线(orchestrator)

在 `runPipeline` 里,问题分析产出后、内容组织前,插入"搜一次 + 下传":
- `PipelineDeps` 增加可选 `search?: (query: string) => Promise<string>`(返回已 `formatSearchContext` 的上下文;注入便于测试,不传则跳过搜索)
- query 取用户输入(+ 可选拼上问题分析产出的一级话题);搜到的上下文拼进**内容组织**和**内容生成**的 user 输入(如 `【联网搜索结果(供参考,注意时效)】\n...`)
- 搜索抛错 → catch 后 log 警告,`searchContext=""`,流水线继续(降级为纯模型作答)

**失败测试要点**(`tests/orchestrator.test.ts` 扩充):
- 注入 fake search,断言其被调用一次(不是每个 agent 各调一次)
- 断言内容组织/生成的 user 含搜索上下文
- 注入会抛错的 search,断言流水线仍走完并 publish(降级)

**验证**:`npx vitest run tests/orchestrator.test.ts` 全绿。commit:`feat: 搜索结果注入流水线(搜一次,下传组织/生成)`

---

## Task 3: prompt 更新(用好搜索结果 + 标注来源)

- `prompts/content-generation.md`:补一段——当提供了"联网搜索结果"时,用它校准主流 vs 过时、补充最新实践;引用处标注来源(可用 markdown 链接),并对时效敏感内容注明时间。
- 可选 `prompts/content-organization.md`:组织骨架时可参考搜索结果决定要不要加"最新进展"小节。
- 不新增角色(搜索是工具,不是 agent)。

**失败测试要点**:`tests/prompts.test.ts` 断言 content-generation 含"搜索结果 / 来源"等关键词。

**验证**:相关单测全绿。commit:`feat: 生成 prompt 支持引用联网结果并标注来源`

---

## Task 4: cli 装配 + 端到端验证

- `src/cli.ts`:实现真实 `search`——用 Node `fetch` 组装 `tavilySearch`(base=`ANTHROPIC_BASE_URL`,key=`ANTHROPIC_API_KEY`),注入 `runPipeline`。
- 开关:`NO_SEARCH=1` 跳过联网(离线/省流);打印"正在联网搜索…"进度。
- 端到端:`GATE_AUTOPASS=1 npm start -- "<时效性主题,如 React 2025 新特性 / Node 原生 TS 支持现状>"`:
  - 日志出现联网搜索一次
  - 飞书文档里能看到基于最新事实的内容 + 来源链接
  - 断网/搜索失败时能降级跑完(纯模型作答)

**验证**:`npm test` 全绿 + `npm run typecheck` + 真实端到端出一篇带来源的文档。commit:`feat: CLI 装配 Tavily 联网搜索 + 端到端`

---

## 完成标准(Plan 2b Done)

- [ ] `npm test` 全绿、`npm run typecheck` 无错
- [ ] `src/tools/tavily.ts` 有测试覆盖,真实能搜到结果
- [ ] 流水线**搜一次**、结果下传给组织/生成(不重复搜)
- [ ] 成稿能引用最新事实并标注来源
- [ ] 搜索失败优雅降级,不阻断整篇

## 下一步(本计划不做)

- **画图(archify)**:独立 plan——spike(装 archify、摸 5 类图 schema、验证 SVG 进飞书画板 vs PNG 图片)→ archify 调用工具 → 图规划角色 → 插图编排。把内容里的 `【配图指令】` 变成真图。
- **查重去重合并**:`drive +search` 找旧文档 → `block_insert_after` 插增量(设计文档"问·存·改"闭环)。
- **Plan 3 / Distiller**:门反馈 → 蒸馏规则 → 批准 → 写回 prompts + commit。
