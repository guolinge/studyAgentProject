# 待办 / Backlog

## 输入模式扩展

### ② 问题 + AI 回答 输入支持
当用户粘贴"问题 + AI 中台的回答"时，流水线应识别意图差异：
- **整理归档**：把现有回答整理成规范文档写入飞书
- **拓展补充**：在回答基础上针对某些概念做深度扩展

需要改动：`prompts/question-analysis.md` — 识别"已有答案"输入模式，在"意图"section 区分两种场景，并调整后续内容生成的策略。

### ③ 链接输入支持
当用户输入一个或多个 URL（微信公众号、普通网页），流水线应：
1. 识别输入中含有 URL
2. 抓取网页正文（fetch / Tavily extract / playwright）
3. 将正文注入 question-analysis 的 user prompt，后续流程正常走

需要改动：
- `src/tools/` 新增网页抓取工具（优先复用 Tavily extract，fallback 到 fetch + HTML 解析）
- `src/cli.ts` / `src/server.ts`：输入预处理，检测 URL 并触发抓取
- `prompts/question-analysis.md`：提示 agent 如何处理已提供网页内容
