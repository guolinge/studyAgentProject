# Plan 2d — 查重去重合并:研究前先查已有文档,增量插进旧文锚点

## Context(为什么做这个)

Plan 1~2c 每次都**新建**飞书文档。但用户痛点 2/3/4 正是:重复研究(已记录过又从零问一遍)、分类混乱(重复文件夹)、内容僵硬(想在旧文锚点补内容做不到)。设计文档的核心闭环"**问·存·改**"就差这一环。

Plan 2d:研究新知识前**先查重**——搜用户已有的相关旧文档;若发现相关,**门让用户选**"合并进旧文档"还是"新建";选合并则读旧文结构、生成增量、用 `block_insert_after` **插进相关小节锚点**,而不是造重复文档。

## 已定决策(用户拍板)

- 发现疑似相关旧文档时,**门让用户选**(合并进X / 新建 / 先看X)。不 agent 自动决定,避免误合并。
- 合并时**增量插入相关小节锚点**(`block_insert_after`),不是追加末尾。

## 查重实测关键结论(Explore,决定实现细节)

- 主查重命令:`drive +search --query <单个核心词> --only-title --mine`。
- **必须 `--mine`**(锁定本人知识库,否则召回全租户别人的同名文档 → 误合并);`--only-title` 精准判"是否已有此主题"。
- **按单个核心词逐个搜**,不要空格拼多词(易 0 命中);中文主题词 + 英文缩写双路召回;query ≤30 码点(超长静默截断)。
- 结果**过滤掉 folder**,只对 `result_meta.doc_types=DOCX` 的真文档合并;抽字段 `{title_highlighted, result_meta.url, result_meta.token, result_meta.doc_types}`。
- 锚点:`docs +fetch --doc <url> --scope outline` 一步返回所有 `<h2 id=…>/<h3 id=…>` 稳定 block_id → `docs +update --command block_insert_after --block-id <标题id> --content <增量>`。

## 集成思路(顶层查重分流)

```
问题分析(顺带产出"查重关键词")
  → 查重:逐词 drive +search --only-title --mine → 过滤 folder → 汇总候选旧文档(去重)
  → 🚪 查重门(轻):有候选才弹;展示候选列表,用户输入序号=合并进该篇 / 回车=新建
     ├─ 新建 → 走原 runPipeline(组织→门2→生成→审核→新建文档),流程不变
     └─ 合并进 N → mergeFlow:
          fetch 旧文档 outline(标题+block_id)
          → 增量生成 agent:读旧文结构 + 新知识点 → 产出 { 锚点标题id, 增量 markdown }
          → block_insert_after 把增量插到该锚点后(markdown 格式)
          → 返回旧文档 url(已就地增补)
```

要点:查重门只在**有候选**时弹(无候选直接走新建,不打扰);合并的增量也可含【配图指令】(复用 2c 画图,先文字后补图);合并失败(定位/插入出错)则降级为新建,不丢内容。

(下面分 Task,先失败测试再实现,末尾 git 提交)

---

## Task 1: lark 查重/读大纲/锚点插入工具(扩 src/tools/lark.ts)

延续现有"纯函数构造 argv + 注入 CliRunner"模式,新增三个能力:
- `buildSearchArgs(query, {mine, onlyTitle})` + `larkSearchDocs(...)`:`drive +search`,解析 `data.results`,**过滤 `result_meta.doc_types!=DOCX`(去掉 folder)**,`title_highlighted` 去掉 `<h>` 标签,返回 `{title,url,token}[]`。
- `buildFetchOutlineArgs(docUrl)` + `larkFetchOutline(...)`:`docs +fetch --doc <url> --scope outline`,返回大纲文本(含 `<h2 id=…>` 标题 block_id)。
- `buildBlockInsertAfterArgs(docUrl, blockId, format)` + `larkBlockInsertAfter(docUrl, blockId, content, ...)`:`docs +update --command block_insert_after --block-id <id> --content -`(content 走 stdin,默认 markdown)。

**失败测试要点**(`tests/lark.test.ts` 扩充):三组 argv 构造断言;`larkSearchDocs` 用 fake runner 返回混有 folder 的样例 JSON → 断言只保留 DOCX、title 去标签;insert argv 含 `block_insert_after`/`--block-id`。

**验证**:`npx vitest run tests/lark.test.ts` 全绿。commit:`feat: lark 查重/读大纲/锚点插入工具`

---

## Task 2: 查重关键词 + 查重搜索(src/dedup.ts)

- `prompts/question-analysis.md`:在输出格式里加一节 `## 查重关键词`,让问题分析顺带产出 3~5 个**单个核心词**(中文主题词 + 常见英文缩写,每个 ≤30 码点、不拼空格短语)。
- `parseDedupKeywords(qaOutput)`:纯函数,从问题分析产出里提取关键词列表。
- `searchDuplicates(keywords, deps)`:逐词调注入的 `search(keyword)`,把候选按 `token` **去重合并**,返回候选文档列表。

**失败测试要点**(`tests/dedup.test.ts`):`parseDedupKeywords` 提取多词;`searchDuplicates` 注入 fake search,验证逐词搜 + 按 token 去重(同一文档多词命中只留一条)。

**验证**:`npx vitest run tests/dedup.test.ts` 全绿。commit:`feat: 查重关键词提取 + 逐词搜索去重`

---

## Task 3: 查重门 + 分流(合并 / 新建)

- `formatDedupPrompt(candidates)`:纯函数,把候选列成"1. 标题(url) / 2. …",生成查重门的展示文本。
- `parseGateChoice(reply, candidates)`:纯函数解析门输入 —— 数字序号 → 选中该候选;空/非数字 → 新建。返回 `{ action: "merge", target } | { action: "new" }`。
- 编排:问题分析产出后,`searchDuplicates` → **仅当有候选**才 `gate("查重 · 发现相关旧文档", formatDedupPrompt(...))`;按 `parseGateChoice` 分流。无候选直接走新建,不打扰。

**失败测试要点**(`tests/dedup.test.ts` 扩充):`formatDedupPrompt` 含标题与序号;`parseGateChoice`:"2"→merge 第2个、""→new、"3"越界→new。

**验证**:相关单测全绿。commit:`feat: 查重门展示 + 序号分流(合并/新建)`

---

## Task 4: 增量生成角色 + 合并流程(src/merge.ts)

- `prompts/incremental-merge.md`(新角色):输入旧文 outline(标题+block_id) + 新知识点 → 判断增量该插在哪个小节 → 输出**约定格式**:首行 `锚点: <block_id>`,其后是增量 Markdown(可含【配图指令】)。附 style-rules。
- `src/types.ts`:`AgentRole` 加 `"incrementalMerge"`;`agents.config.json` 加该角色。
- `parseMergeOutput(text)`:纯函数,拆出 `{ anchorBlockId, incrementalMarkdown }`。
- `mergeIntoDoc(userInput, targetDoc, deps)`:`larkFetchOutline` → 增量 agent → `parseMergeOutput` → `larkBlockInsertAfter(url, anchorId, incrementalMarkdown)` → 返回 url。锚点非法/插入失败 → 抛错(上层降级为新建)。全部注入,可测。

**失败测试要点**(`tests/merge.test.ts`):`parseMergeOutput` 拆锚点+增量;`mergeIntoDoc` 用 fake(outline/runRole/insert)验证"读大纲→生成→按解析出的锚点 insert"链路与参数。

**验证**:`npx vitest run tests/merge.test.ts` 全绿。commit:`feat: 增量生成角色 + 合并插锚点流程`

---

## Task 5: cli 装配 + 端到端

- `src/cli.ts`:把"查重+门+分流"接进流程(倾向:`runPipeline` 增加可选 `dedup` 注入,问题分析后调用;合并分支走 `mergeIntoDoc` 提前返回)。
- 接入 `incrementalMerge` 角色到 `runRole`;合并的增量同样走"先写后补图"——插入后对增量里的【配图指令】跑 `patchDiagrams`。
- 开关 `NO_DEDUP=1` 跳过查重(直接新建)。
- 端到端:先建一个新主题文档;再用相关主题重跑,验证查重门弹候选、选合并后增量插进旧文对应小节;选新建照常;合并失败降级新建。

**验证**:`npm test` 全绿 + `npm run typecheck` + 真实端到端(查重命中 → 合并插锚点)。commit:`feat: CLI 装配查重去重合并 + 端到端`

---

## 完成标准(Plan 2d Done)

- [ ] `npm test` 全绿、`npm run typecheck` 无错
- [ ] 研究新知识前会查重(`--only-title --mine`、过滤 folder),有相关旧文才弹门
- [ ] 门可选"合并进某篇 / 新建";选合并则增量**插进旧文相关小节锚点**,不新建重复文档
- [ ] 合并失败优雅降级为新建,不丢内容;`NO_DEDUP=1` 可跳过

## 下一步(按 1→2→3,本计划是②)

- **③ Plan 3 / Distiller**:门1/门2/查重门的反馈 → 蒸馏候选规则 → 🚪批准 → 写回 `prompts/*.md` + git commit(每条经验可回溯可回滚)。

