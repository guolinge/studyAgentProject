# Plan — 强化 prompts:补方法论 + 加 few-shot 示例

## Context(为什么做)

通读 8 个 prompt 文件后发现:**最该厚的地方最薄,且全线无示例**。

- `content-generation.md` 是流水线最重的角色(Sonnet + 32k token,真正写正文),但只有几行,几乎全靠 style-rules 兜底——缺行文结构、代码深度标准、推导方法论。
- 8 个文件**一个 few-shot 示例都没有**。style-rules 要的"第一性原理推导""跨界类比""why-not-X"都是高度依赖示范的能力,纯抽象规则难以稳定复现用户要的质感。
- `style-rules.md` 作为 single source of truth 偏纲领:有"禁止生活化比喻"的反向约束,却无"什么是好类比"的正向锚点。

已确认方向(用户拍板):**加 few-shot 示例**(接受每次调用 token +60~80%),用 **debounce 防抖**做贯穿范例。

`drawing-rules.md` / `content-review.md` / `incremental-merge.md` / `question-analysis.md` 已够扎实,本次不动。

## 改动文件(3 个)

### 1. `prompts/style-rules.md` — 补可操作性 + 好/坏类比对照

- **展开"从问题到设计的推导"**:给可操作判定链——问题场景 → 朴素方案 → 暴露缺陷 → 改进 → 定型 → why-not-X。判定标准:"删掉所有'为什么'后若只剩'是什么',即不合格。"
- **加"好类比 vs 坏类比"对照表**(防抖 / 内存缓存 / 事件委托 三组),给正向锚点。
- **加"读者基线"**:HTTP/git/闭包/事件循环等默认已知不必解释,把篇幅留给难点。

### 2. `prompts/content-organization.md` — 附一个完整 debounce 骨架样例

在"输出格式"后加"参考样例"节,给完整三级骨架(问题→推导→实现→取舍),每个 ### 带"要点/表达形式/体量"三行,与文件 3 的范文同主题、可对应。

### 3. `prompts/content-generation.md` — 补方法论 + debounce 范文节选

补三块方法论(行文结构 / 代码标准 / 推导执行法)+ 一段范文节选(骨架 2.2 与 4.1 两节的成文,示范推导链、git amend 类比、带注释闭包、对比表),标注"质感基准,不要照抄"。

## 验证

- `npm test`(85 个)+ `npm run typecheck` 全绿(改的是 .md,确认 prompts.test.ts 仍绿)。
- 计划归档进 repo,随代码一起提交。
- commit:`docs: 强化 prompts(补方法论 + debounce few-shot 示例)`。

## 完成标准

- [x] style-rules 有可操作推导判定 + 好/坏类比对照 + 读者基线
- [x] content-organization 有完整 debounce 骨架样例
- [x] content-generation 有行文结构/代码标准/推导法 + debounce 范文节选
- [ ] `npm test` + `npm run typecheck` 全绿
- [ ] 计划归档进 repo 并随代码一起提交
