# Study Agent

遇到新的 CS 知识点时,自动研究、生成个人风格的深度文档,并保存到飞书。

## 核心功能

- **多 Agent 流水线**:问题分析 → 内容组织 → 内容生成 → 内容审核,两道人工确认门
- **联网搜索**:通过公司 Tavily 代理检索最新资料,注入生成上下文
- **自动配图**:生成 SVG 图表插入飞书画板(先写文字,图片后台异步补齐)
- **查重去重**:研究前先搜已有旧文档,发现相关内容时可选择增量合并而非重复新建
- **规则蒸馏**:把每次在确认门给出的修改意见提炼成 prompt 规则,写回文件并 git commit

## 流水线原理

```
用户输入(知识点)
    │
    ▼
[问题分析 · Haiku]  ←── 提炼意图、一级话题、查重关键词
    │
    ▼ 🚪 门1:确认范围和意图(可给修改意见,agent 重跑)
    │
    ├── 查重:drive +search --only-title --mine
    │       有相关旧文 → 🚪 查重门:选序号=合并进该篇 / 回车=新建
    │                         ↓ 合并
    │                   [增量合并 · Sonnet] → block_insert_after → 旧文更新
    │
    ├── 联网搜索:Tavily 代理(可跳过)
    │
    ▼
[内容组织 · Sonnet]  ←── 生成三级骨架,含配图指令
    │
    ▼ 🚪 门2:确认骨架(可给修改意见,agent 重跑)
    │
    ▼
[内容生成 · Sonnet · 32k]  ←── 完整正文,含【配图指令:...】占位
    │
    ▼
[内容审核 · Haiku]  ←── 对照骨架检查;FAIL 则打回重生成(最多 2 次)
    │
    ▼
写飞书(文字先到)
    │
    ▼
[SVG 作图 · Sonnet · 并行]  ←── 每张图独立生成+校验,str_replace 替换占位
    │
    ▼ (若本次有门反馈)
[蒸馏器 · Haiku]  ←── 反馈 → 规律提炼 → 🚪 批准 → 写回 prompts/ + git commit
```

### 文档质量规则(style-rules.md)

生成的文档固定遵循:
- 从问题推导到设计,讲清"为什么这么设计"和被否决的替代方案
- 把新概念连接到已知技术(git、HTTP、文件系统等),禁止生活化比喻
- 每段代码配注释(JS/TS),能用图表达的用图
- 标注主流 vs 过时方案

## 环境准备

**前置条件**

- Node.js ≥ 20
- `ft-lark-cli`(飞书 CLI 工具,需配置好飞书账号):`npm install -g ft-lark-cli`
- 公司 AI 网关访问权限(提供 API Key)

**安装**

```bash
git clone <repo>
cd studyAgentProject
npm install
```

**配置 `.env`**

```bash
cp .env.example .env   # 若无示例文件则直接新建
```

`.env` 内容:

```env
# 必填:公司统一 AI Key
ANTHROPIC_API_KEY=your-key-here

# 必填:公司 AI 网关(同时支持 Anthropic 格式和 Tavily 代理)
ANTHROPIC_BASE_URL=https://llm-proxy.example.com
```

> `.env` 已在 `.gitignore` 中,不会被提交。

## 使用方法

**基本用法**

```bash
npm start -- "你想搞懂的知识点"

# 示例
npm start -- "pnpm 的 peer dependencies 处理机制"
npm start -- "Promise 微任务队列和 Event Loop 的关系"
npm start -- "TCP 三次握手为什么不是两次"
```

**运行过程**

1. 终端打印问题分析结果,等待 **门1** 确认(直接回车=通过,输入意见=重跑)
2. 打印骨架,等待 **门2** 确认
3. 若发现相关旧文档,弹出 **查重门**(输入序号合并 / 回车新建)
4. 生成完整正文 → 写入飞书 → 打印文档 URL(此时文字已可阅读)
5. 后台异步生成配图,陆续补入飞书
6. 若本次有过门反馈,蒸馏器弹出 **批准门**,回车应用规则变更

## 环境变量开关

| 变量 | 说明 |
|------|------|
| `LARK_DRY_RUN=1` | 不写飞书,在终端打印最终 Markdown |
| `NO_SEARCH=1` | 跳过联网搜索 |
| `NO_DEDUP=1` | 跳过查重去重 |
| `NO_DIAGRAM=1` | 跳过 SVG 配图 |
| `NO_DISTILLER=1` | 跳过蒸馏器 |
| `GATE_AUTOPASS=1` | 所有门自动通过(适合自动化测试) |
| `DEDUP_CHOICE=N` | 配合 `GATE_AUTOPASS`,查重门自动选第 N 篇合并 |
| `MODEL_OVERRIDE=<model-id>` | 覆盖所有 agent 的模型(调试省 token 用) |
| `EFFORT_OVERRIDE=low\|medium\|high` | 覆盖所有 agent 的 effort |

**调试示例(不写飞书,跳过配图)**

```bash
LARK_DRY_RUN=1 NO_DIAGRAM=1 npm start -- "Event Loop 原理"
```

**省 token 测试**

```bash
MODEL_OVERRIDE=claude-haiku-4-5-20251001 EFFORT_OVERRIDE=low \
  GATE_AUTOPASS=1 NO_DIAGRAM=1 npm start -- "测试话题"
```

## 模型配置

配置文件:`agents.config.json`

| 角色 | 模型 | 说明 |
|------|------|------|
| 内容组织 / 生成 / 画图 / 增量合并 | claude-sonnet-4-6 | 质量关键环节 |
| 问题分析 / 内容审核 / 蒸馏器 | claude-haiku-4-5-20251001 | 轻量环节节省 token |

## 开发

```bash
npm test          # 运行全部测试(85 个)
npm run typecheck # TypeScript 类型检查
npm run test:watch # 监听模式
```

**项目结构**

```
src/
  cli.ts           # 入口,装配所有依赖
  orchestrator.ts  # 流水线编排(问题分析→组织→生成→审核→发布)
  agentRunner.ts   # 单个 agent 调用(streaming)
  config.ts        # agents.config.json 加载与合并
  diagrams.ts      # 配图编排(提取指令→并行生成→补入飞书)
  dedup.ts         # 查重关键词提取、逐词搜索、门展示与分流
  merge.ts         # 增量合并(fetch outline→生成增量→插锚点)
  distiller.ts     # 蒸馏器(解析变更、应用到文件)
  io.ts            # 门交互(readline asker)
  prompts.ts       # prompt 文件加载
  tools/
    lark.ts        # 飞书 CLI 封装(建文档/查重/读大纲/插锚点/更新)
    tavily.ts      # Tavily 联网搜索
    svg.ts         # SVG 提取与飞书兼容性校验

prompts/           # 各角色 prompt 文件(可被蒸馏器自动更新)
agents.config.json # 模型与参数配置
docs/superpowers/plans/  # 各阶段实现方案归档
```
