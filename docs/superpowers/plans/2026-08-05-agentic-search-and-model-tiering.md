# Agentic 联网研究 + 模型分级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把"盲搜一次 5 条浅摘要"的联网搜索升级为模型自主决策的 agentic 研究步骤（自己搜、自己选读哪几篇全文、不够再搜），并将其作为可在"模型配置"面板配置的独立角色；同时把 questionAnalysis 从 Haiku 升级到 Sonnet。

**Architecture:** 新增 `searchResearch` 角色，它通过一个带工具（`web_search` / `read_page`）的 tool-use 循环运行，输出结构化"研究备忘录"，注入内容组织与内容生成。工具循环封装在 `agentRunner.ts` 的新函数 `runAgentWithTools`，工具执行器在 `server.ts` / `cli.ts` 的 `runRole` 内按角色分派。orchestrator 用 `runRole("searchResearch")` 替换原来的一次性 `deps.search` 注入，因此研究步骤自动获得进度事件、token 统计和模型配置。

**Tech Stack:** TypeScript ESM + Node 20 + vitest；Anthropic SDK（走公司网关，Anthropic 协议）；Tavily 透明代理（`/tavily/api-server/search` 与 `/tavily/api-server/extract`）。

**执行前风险确认（非阻塞，执行 Task 5 后手动验证）：** 公司网关对 tool-use（`tools` 参数 + `stop_reason: "tool_use"`）的支持需实测。若网关不支持工具调用，Task 5 手动验证会暴露，届时降级策略为：searchResearch 退回单次 `web_search` + 一次可选 `read_page`（不循环）。此风险不影响 Task 1–4 的独立可测性。

---

## File Structure

改动/新增文件及职责：

| 文件 | 类型 | 职责 |
|---|---|---|
| `src/tools/tavily.ts` | 修改 | 新增 `tavilyExtract()`：调 `/tavily/api-server/extract` 拉单页全文 |
| `src/agentRunner.ts` | 修改 | 拓宽 `ModelClient` 返回类型（含 `stop_reason` 与 tool_use 块字段）；新增 `runAgentWithTools()` tool-use 循环 |
| `src/types.ts` | 修改 | `AgentRole` 联合类型加入 `"searchResearch"` |
| `agents.config.json` | 修改 | `questionAnalysis` 升级为 Sonnet；新增 `searchResearch` 配置 |
| `prompts/search-research.md` | 新建 | searchResearch 的 system prompt（工具使用规则 + 备忘录输出格式） |
| `web/lib/settingsTypes.ts` | 修改 | `AGENT_ROLE_LABELS` 加入 `searchResearch: "联网研究"`（面板自动渲染） |
| `src/orchestrator.ts` | 修改 | 移除 `deps.search` 字符串搜索路径，改为 `runRole("searchResearch")` 研究步骤，注入 org/gen |
| `src/server.ts` | 修改 | `ROLE_LABEL` 加标签；`runRole` 对 searchResearch 分派到 `runAgentWithTools`；定义工具与执行器；`deps.researchEnabled` |
| `src/cli.ts` | 修改 | 与 server.ts 相同的 `runRole` 分派与 `researchEnabled` 装配 |
| `tests/tavily.test.ts` | 修改 | 新增 `tavilyExtract` 测试 |
| `tests/agentRunner.test.ts` | 修改 | 新增 `runAgentWithTools` 测试 |
| `tests/orchestrator.test.ts` | 修改 | 改写原 search 相关测试为 searchResearch 研究步骤测试 |

**任务依赖顺序：** Task 1（tavilyExtract）与 Task 2（runAgentWithTools）互相独立，均为纯逻辑可 TDD；Task 3（类型/配置/prompt）为声明性改动；Task 4（orchestrator）依赖 Task 3 的角色名；Task 5（server 装配）依赖 Task 1、2、3；Task 6（cli 装配）依赖 Task 1、2、3。建议顺序 1→2→3→4→5→6。

---

### Task 1: tavilyExtract（读取单页全文）

**Files:**
- Modify: `src/tools/tavily.ts`
- Test: `tests/tavily.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/tavily.test.ts` 末尾追加：

```ts
import { buildExtractRequest, tavilyExtract } from "../src/tools/tavily.js";

describe("buildExtractRequest", () => {
  it("targets the tavily extract path with urls in body", () => {
    const { url, body } = buildExtractRequest("https://pnpm.io", {
      base: "https://llm-proxy.futuoa.com",
    });
    expect(url).toBe("https://llm-proxy.futuoa.com/tavily/api-server/extract");
    const parsed = JSON.parse(body);
    expect(parsed.urls).toEqual(["https://pnpm.io"]);
  });

  it("trims trailing slash on base", () => {
    const { url } = buildExtractRequest("https://a.com", { base: "https://host/" });
    expect(url).toBe("https://host/tavily/api-server/extract");
  });
});

const extractSample = JSON.stringify({
  results: [
    { url: "https://pnpm.io", raw_content: "pnpm 全文内容……很长的正文……" },
  ],
  failed_results: [],
});

describe("tavilyExtract", () => {
  it("returns the raw_content of the first result and sends auth header", async () => {
    const httpPost: HttpPost = vi.fn().mockResolvedValue(extractSample);
    const text = await tavilyExtract("https://pnpm.io", {
      base: "https://llm-proxy.futuoa.com", apiKey: "K", httpPost,
    });
    expect(text).toContain("pnpm 全文内容");
    const [callUrl, headers] = (httpPost as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callUrl).toContain("/tavily/api-server/extract");
    expect(headers.Authorization).toBe("Bearer K");
  });

  it("returns a readable message when extraction yields no content", async () => {
    const httpPost: HttpPost = vi.fn().mockResolvedValue(
      JSON.stringify({ results: [], failed_results: [{ url: "https://x.com" }] }),
    );
    const text = await tavilyExtract("https://x.com", { base: "B", apiKey: "K", httpPost });
    expect(text).toContain("未能提取");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/tavily.test.ts`
Expected: FAIL —「buildExtractRequest is not a function」/「tavilyExtract is not a function」

- [ ] **Step 3: 实现 tavilyExtract**

在 `src/tools/tavily.ts` 末尾追加（复用已有的 `HttpPost`、`defaultHttpPost`、`TavilyDeps`）：

```ts
/**
 * 纯函数:构造 Tavily extract 的请求 URL 与 body。
 * extract 与 search 同属透明代理,路径为 /tavily/api-server/extract。
 * body.urls 传数组;这里一次只取一个 URL。
 */
export function buildExtractRequest(pageUrl: string, opts: { base: string }): { url: string; body: string } {
  const base = opts.base.replace(/\/+$/, "");
  const url = `${base}/tavily/api-server/extract`;
  const body = JSON.stringify({ urls: [pageUrl] });
  return { url, body };
}

/**
 * 读取单个网页正文全文。
 * 成功返回 results[0].raw_content;无内容时返回可读提示(不 throw,
 * 让 agent 能据此换一篇再读,而不是整轮失败)。
 */
export async function tavilyExtract(pageUrl: string, deps: TavilyDeps): Promise<string> {
  const httpPost = deps.httpPost ?? defaultHttpPost;
  const { url, body } = buildExtractRequest(pageUrl, { base: deps.base });
  const headers = {
    Authorization: `Bearer ${deps.apiKey}`,
    "Content-Type": "application/json",
  };
  const raw = await httpPost(url, headers, body);
  const parsed = JSON.parse(raw) as { results?: Array<{ url?: string; raw_content?: string }> };
  const content = parsed.results?.[0]?.raw_content ?? "";
  if (!content.trim()) return `（未能提取 ${pageUrl} 的正文）`;
  return content;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/tavily.test.ts`
Expected: PASS（所有旧测试 + 新测试）

- [ ] **Step 5: 提交**

```bash
git add src/tools/tavily.ts tests/tavily.test.ts
git commit -m "feat: add tavilyExtract to read full page content via /extract"
```

---

### Task 2: runAgentWithTools（tool-use 循环）

**Files:**
- Modify: `src/agentRunner.ts`
- Test: `tests/agentRunner.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/agentRunner.test.ts` 末尾追加：

```ts
import { runAgentWithTools, type ToolDef, type ToolExecutor } from "../src/agentRunner.js";

const TOOLS: ToolDef[] = [
  { name: "web_search", description: "搜索", input_schema: { type: "object", properties: {} } },
];

describe("runAgentWithTools", () => {
  it("executes tools then returns final text, echoing full assistant content back", async () => {
    const createMessage = vi.fn()
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [
          { type: "thinking", thinking: "想一下" },
          { type: "tool_use", id: "t1", name: "web_search", input: { query: "pnpm" } },
        ],
      })
      .mockResolvedValueOnce({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "研究备忘录：pnpm 用硬链接。" }],
      });

    const execute: ToolExecutor = vi.fn().mockResolvedValue("标题/摘要列表");
    const out = await runAgentWithTools(
      { system: "你是研究员", user: "研究 pnpm" }, cfg, { createMessage }, TOOLS, execute,
    );

    expect(out).toBe("研究备忘录：pnpm 用硬链接。");
    expect(execute).toHaveBeenCalledWith("web_search", { query: "pnpm" });
    expect(createMessage).toHaveBeenCalledTimes(2);

    // 第二次调用的 messages 里应回放了完整 assistant 内容 + tool_result
    const secondMessages = createMessage.mock.calls[1][0].messages;
    expect(secondMessages[1].role).toBe("assistant");
    expect(secondMessages[1].content).toEqual([
      { type: "thinking", thinking: "想一下" },
      { type: "tool_use", id: "t1", name: "web_search", input: { query: "pnpm" } },
    ]);
    expect(secondMessages[2].role).toBe("user");
    expect(secondMessages[2].content[0]).toEqual({
      type: "tool_result", tool_use_id: "t1", content: "标题/摘要列表",
    });
    // 第一次带 tools,以驱动工具调用
    expect(createMessage.mock.calls[0][0].tools).toBe(TOOLS);
  });

  it("returns text immediately when the model does not call a tool", async () => {
    const createMessage = vi.fn().mockResolvedValue({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "直接结论" }],
    });
    const out = await runAgentWithTools(
      { system: "s", user: "u" }, cfg, { createMessage }, TOOLS, vi.fn(),
    );
    expect(out).toBe("直接结论");
    expect(createMessage).toHaveBeenCalledOnce();
  });

  it("forces a final tool-free answer after maxRounds", async () => {
    // 一直返回 tool_use;到达上限时最后一次调用不应再带 tools
    const createMessage = vi.fn().mockImplementation((params: any) => {
      if (params.tools) {
        return Promise.resolve({
          stop_reason: "tool_use",
          content: [{ type: "tool_use", id: "t", name: "web_search", input: {} }],
        });
      }
      return Promise.resolve({ stop_reason: "end_turn", content: [{ type: "text", text: "兜底结论" }] });
    });
    const out = await runAgentWithTools(
      { system: "s", user: "u" }, cfg, { createMessage }, TOOLS, vi.fn().mockResolvedValue("r"), 2,
    );
    expect(out).toBe("兜底结论");
    // maxRounds=2 → 2 轮带 tools + 1 次不带 tools = 3 次
    expect(createMessage).toHaveBeenCalledTimes(3);
    expect(createMessage.mock.calls[2][0].tools).toBeUndefined();
  });

  it("feeds a readable error back as tool_result when executor throws", async () => {
    const createMessage = vi.fn()
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "t1", name: "read_page", input: { url: "x" } }],
      })
      .mockResolvedValueOnce({ stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] });
    const execute: ToolExecutor = vi.fn().mockRejectedValue(new Error("boom"));
    const out = await runAgentWithTools({ system: "s", user: "u" }, cfg, { createMessage }, TOOLS, execute);
    expect(out).toBe("ok");
    const secondMessages = createMessage.mock.calls[1][0].messages;
    expect(secondMessages[2].content[0].content).toContain("boom");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/agentRunner.test.ts`
Expected: FAIL —「runAgentWithTools is not a function」

- [ ] **Step 3: 拓宽 ModelClient 类型**

在 `src/agentRunner.ts` 中，把 `ModelClient` 接口替换为（新增 `stop_reason` 与 tool_use 块字段，向后兼容 runAgent 现有用法）：

```ts
export interface ModelClient {
  createMessage(params: Record<string, unknown>): Promise<{
    content: Array<{
      type: string;
      text?: string;
      // tool_use 块字段(runAgent 忽略,runAgentWithTools 使用)
      id?: string;
      name?: string;
      input?: unknown;
      // thinking 块字段(仅用于原样回放)
      thinking?: string;
    }>;
    stop_reason?: string | null;
  }>;
}
```

- [ ] **Step 4: 实现 runAgentWithTools**

在 `src/agentRunner.ts` 末尾追加：

```ts
/** 工具定义(Anthropic tools 参数的单项) */
export interface ToolDef {
  name: string;
  description: string;
  input_schema: object;
}

/** 工具执行器:按名字执行,返回给模型的文本结果 */
export type ToolExecutor = (name: string, input: unknown) => Promise<string>;

/**
 * 带工具的 agent 循环。
 *
 * 流程:
 *   1. 带 tools 调模型
 *   2. stop_reason==="tool_use" → 执行每个 tool_use,把结果作为 tool_result 回传,继续
 *   3. 否则 → 拼接 text 块返回
 *
 * 上限保护:最多 maxRounds 轮带工具的调用;到达上限后再做一次"不带 tools"的调用,
 * 强制模型给出文字结论,避免无限循环。
 *
 * thinking 回放:把模型返回的完整 content(含 thinking / tool_use 块)原样 push 回
 * messages,满足 adaptive thinking + tool use 的回放要求。
 */
export async function runAgentWithTools(
  input: AgentInput,
  cfg: ResolvedAgentConfig,
  client: ModelClient,
  tools: ToolDef[],
  execute: ToolExecutor,
  maxRounds = 6,
): Promise<string> {
  const messages: Array<{ role: string; content: unknown }> = [
    { role: "user", content: input.user },
  ];

  for (let round = 0; round <= maxRounds; round++) {
    const params: Record<string, unknown> = {
      model: cfg.model,
      max_tokens: cfg.maxTokens,
      system: input.system,
      output_config: { effort: cfg.effort },
      messages,
    };
    if (cfg.thinking === "adaptive") params.thinking = { type: "adaptive" };
    // 最后一轮不带 tools,强制文字结论
    if (round < maxRounds) params.tools = tools;

    const resp = await client.createMessage(params);
    const toolUses = resp.content.filter((b) => b.type === "tool_use");

    if (resp.stop_reason !== "tool_use" || toolUses.length === 0) {
      return resp.content
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string)
        .join("");
    }

    // 回放完整 assistant 内容(保留 thinking 块)
    messages.push({ role: "assistant", content: resp.content });

    const results = [];
    for (const tu of toolUses) {
      let out: string;
      try {
        out = await execute(tu.name as string, tu.input);
      } catch (e) {
        out = `工具执行失败：${(e as Error).message}`;
      }
      results.push({ type: "tool_result", tool_use_id: tu.id, content: out });
    }
    messages.push({ role: "user", content: results });
  }

  return "";
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/agentRunner.test.ts`
Expected: PASS（旧 runAgent 测试 + 4 个新测试）

- [ ] **Step 6: 提交**

```bash
git add src/agentRunner.ts tests/agentRunner.test.ts
git commit -m "feat: add runAgentWithTools tool-use loop with bounded rounds"
```

---

### Task 3: 角色声明 + 配置 + prompt + 面板标签

**Files:**
- Modify: `src/types.ts`
- Modify: `agents.config.json`
- Create: `prompts/search-research.md`
- Modify: `web/lib/settingsTypes.ts`
- Test: `tests/config.test.ts`（验证新配置可加载）

- [ ] **Step 1: 在 AgentRole 加入 searchResearch**

`src/types.ts` 中把 `AgentRole` 联合类型改为（在 questionAnalysis 后新增一行）：

```ts
export type AgentRole =
  | "questionAnalysis"     // 问题分析:framing 用户意图,输出一级话题 + 查重关键词
  | "searchResearch"       // 联网研究:带工具(search/read_page)自主检索,输出研究备忘录
  | "contentOrganization"  // 内容组织:生成三级骨架(门2 前)
  | "contentGeneration"    // 内容生成:产出完整正文 Markdown(含【配图指令】占位)
  | "contentReview"        // 内容审核:对照骨架检查,PASS/FAIL
  | "diagramSvg"           // SVG 作图:把一条配图指令转成自包含 SVG
  | "incrementalMerge"     // 增量合并:读旧文大纲 + 新知识 → 产出{锚点 block_id, 增量 markdown}
  | "distiller";           // 蒸馏器:门反馈 → 规律提炼 → 提出 prompt 改动建议
```

- [ ] **Step 2: 更新 agents.config.json**

把 `agents.config.json` 的 `agents.questionAnalysis` 升级为 Sonnet，并新增 `searchResearch`。完整文件内容：

```json
{
  "defaults": {
    "model": "claude-sonnet-4-6",
    "effort": "high",
    "maxTokens": 16000,
    "thinking": "adaptive"
  },
  "agents": {
    "questionAnalysis": {
      "model": "claude-sonnet-4-6",
      "effort": "medium"
    },
    "searchResearch": {
      "model": "claude-sonnet-4-6",
      "effort": "high",
      "maxTokens": 12000
    },
    "contentOrganization": {
      "effort": "high"
    },
    "contentGeneration": {
      "effort": "high",
      "maxTokens": 32000
    },
    "contentReview": {
      "model": "claude-haiku-4-5-20251001",
      "effort": "low"
    },
    "diagramSvg": {
      "effort": "medium",
      "maxTokens": 8000,
      "thinking": "disabled"
    },
    "incrementalMerge": {
      "effort": "high",
      "maxTokens": 32000
    },
    "distiller": {
      "model": "claude-haiku-4-5-20251001",
      "effort": "low"
    }
  }
}
```

- [ ] **Step 3: 运行 config 测试确认仍通过**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS（`z.record` 不锁 role 名，新增角色无需改 schema）

- [ ] **Step 4: 创建 prompts/search-research.md**

新建 `prompts/search-research.md`，内容：

```markdown
# 角色:联网研究(流水线第 2 步,门1 之后 / 内容组织之前)

你是知识流水线的研究员。上游已确认了**意图**和**一级话题**。你的任务是**为后续写作收集充分、准确、可信的资料**,产出一份结构化的《研究备忘录》。

你有两个工具:

- `web_search(query, max_results?)` — 按查询词搜索,返回若干条**标题 + URL + 摘要**(不含正文)。`max_results` 默认 5。
- `read_page(url)` — 读取某个 URL 的**网页正文全文**。

## 工作方式(自主决策)

1. 先按一级话题**分别搜索**(每个话题至少一次 `web_search`),用不同的关键词覆盖不同角度。
2. 看搜索返回的标题和摘要,**判断哪几篇最权威、最相关**(官方文档 > 高质量博客 > 论坛),对值得深读的用 `read_page` 拉全文。
3. 全文读完后,若发现某个话题资料仍不足,或冒出了新的关键子概念,**再搜、再读**。
4. 你自己判断资料是否充分。**不要盲目穷尽**:一般 3~6 次工具调用足够;精读 2~4 篇高质量全文即可。信息够了就停,输出备忘录。

## 约束

- 只做研究和取证,**不写文章正文、不列骨架**(那是下游的事)。
- 备忘录要**忠于来源**:关键结论标注来源 URL;区分"事实"与"我的推断"。
- 注意时效性:优先近一两年的资料;点明版本/日期敏感的信息。
- 若联网完全不可用或搜不到有用内容,输出一句话说明,不要编造。

## 输出格式(严格)

```
# 研究备忘录:<主题>

## 关键事实与结论
- <结论1>（来源：<URL>）
- <结论2>（来源：<URL>）
...

## 按话题的资料
### <一级话题A>
<该话题下查到的要点、代码片段、数据,标注来源>
### <一级话题B>
...

## 框定补充（可选，仅当研究中发现框定漏了重要子话题时输出）
- 建议补充话题：<话题> — 理由：<为什么重要>

## 存疑/待核实（可选）
- <有争议或未能证实的点>
```
```

- [ ] **Step 5: 在面板角色标签中加入 searchResearch**

`web/lib/settingsTypes.ts` 的 `AGENT_ROLE_LABELS` 改为（在 questionAnalysis 后加一行；面板靠 `Object.keys` 自动渲染，无需改组件）：

```ts
export const AGENT_ROLE_LABELS: Record<string, string> = {
  questionAnalysis:    "问题分析",
  searchResearch:      "联网研究",
  contentOrganization: "内容组织",
  contentGeneration:   "内容生成",
  contentReview:       "内容审核",
  diagramSvg:          "SVG 作图",
  incrementalMerge:    "增量合并",
  distiller:           "沉淀",
};
```

- [ ] **Step 6: 类型检查 + 提交**

Run: `npm run typecheck`
Expected: 通过（若 orchestrator/server/cli 尚未处理新角色也不会报错，因为 `AgentRole` 是开放使用，无 exhaustive switch 依赖它——若类型检查报 exhaustive 错误，记录到 Task 4/5/6 处理）

```bash
git add src/types.ts agents.config.json prompts/search-research.md web/lib/settingsTypes.ts
git commit -m "feat: declare searchResearch role, upgrade questionAnalysis to Sonnet"
```

---

### Task 4: orchestrator 接入研究步骤

**Files:**
- Modify: `src/orchestrator.ts`
- Test: `tests/orchestrator.test.ts`

- [ ] **Step 1: 改写 orchestrator 测试**

在 `tests/orchestrator.test.ts` 中，找到原来测试 `search`（字符串搜索注入）的两个用例：
- `"calls search once and injects its context into organization & generation"`
- `"degrades gracefully when search throws (still publishes)"`

将它们替换为下面两个用例（用 `runRole("searchResearch")` 的返回值验证注入；`researchEnabled: true` 开启研究步骤）：

```ts
it("runs searchResearch and injects its memo into organization & generation", async () => {
  const { runRole, calls } = makeRunRole({
    questionAnalysis:    "## 意图\nX\n## 一级话题\n- a",
    searchResearch:      "研究备忘录：MEMO",
    contentOrganization: "骨架",
    contentGeneration:   "正文",
    contentReview:       "PASS",
  });
  const gate = vi.fn().mockResolvedValue("");
  const publish = vi.fn().mockResolvedValue("http://doc");
  await runPipeline("讲讲 X", {
    loadPrompt, runRole, gate, publish, researchEnabled: true,
  });

  // searchResearch 被调用一次
  const researchCalls = calls.filter((c) => c.role === "searchResearch");
  expect(researchCalls).toHaveLength(1);
  // 备忘录注入到内容组织与内容生成的 user
  const orgCall = calls.find((c) => c.role === "contentOrganization");
  const genCall = calls.find((c) => c.role === "contentGeneration");
  expect(orgCall!.input.user).toContain("研究备忘录：MEMO");
  expect(genCall!.input.user).toContain("研究备忘录：MEMO");
});

it("degrades gracefully when searchResearch throws (still publishes)", async () => {
  const runRole = vi.fn(async (role: string) => {
    if (role === "searchResearch") throw new Error("网关不支持工具");
    if (role === "questionAnalysis") return "## 意图\nX\n## 一级话题\n- a";
    if (role === "contentReview") return "PASS";
    return "stub";
  });
  const gate = vi.fn().mockResolvedValue("");
  const publish = vi.fn().mockResolvedValue("http://doc");
  const res = await runPipeline("讲讲 X", {
    loadPrompt, runRole, gate, publish, researchEnabled: true,
  });
  expect(publish).toHaveBeenCalledOnce(); // 研究失败仍然出稿
  expect((res as { kind: string }).kind).toBe("single");
});
```

注意：若 `makeRunRole` 的 stub map 尚未支持 `searchResearch` key，它本来就是「按 role 取值」的通用实现（见文件顶部 `makeRunRole`），加一个 key 即可，无需改 helper。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/orchestrator.test.ts`
Expected: FAIL（orchestrator 还在用 `deps.search`，`researchEnabled` 未被识别，备忘录不会注入）

- [ ] **Step 3: 修改 PipelineDeps 接口**

`src/orchestrator.ts` 的 `PipelineDeps` 接口：删除 `search?` 字段，新增 `researchEnabled?`。改为：

```ts
export interface PipelineDeps {
  loadPrompt: (name: string) => string;
  runRole: (role: AgentRole, input: AgentInput) => Promise<string>;
  gate: Asker;              // 门1/门2/查重门共用同一个 Asker 实例
  publish: (markdown: string, placement: PlacementInfo) => Promise<string>; // 写飞书,返回文档 URL
  reviewMaxRetries?: number; // 审核打回上限,默认 2
  researchEnabled?: boolean; // 开启联网研究步骤(searchResearch);网关不可用时为 false
  dedup?: {
    search: (keyword: string) => Promise<SearchHit[]>; // 查重搜索
    merge: (userInput: string, target: SearchHit) => Promise<{ url: string; incrementalMarkdown: string }>;
  };
  updateIndex?: (title: string, url: string) => Promise<void>; // 每次 publish 后追加总索引一行
  onReviewFeedback?: (feedback: string) => void; // 内容审核 FAIL 时推送反馈内容
  patchDocDiagrams?: (docUrl: string) => Promise<{ url: string; patched: number; total: number }>;
}
```

- [ ] **Step 4: 替换搜索逻辑**

在 `src/orchestrator.ts` 的 `runPipeline` 中，找到这段（联网搜索 + `withSearch`）：

```ts
  // 联网搜索:搜一次,结果顺流水线下传(注入到组织和生成的 user prompt)
  // 失败时优雅降级:不中断流水线,只是生成内容不含最新资料
  let searchContext = "";
  if (deps.search) {
    try {
      searchContext = await deps.search(userInput);
    } catch (e) {
      console.error(`  ⚠ 联网搜索失败,降级为纯模型作答:${(e as Error).message}`);
      searchContext = "";
    }
  }
  // 工具函数:有搜索结果时追加到 base 末尾;没有时原样返回
  const withSearch = (base: string) => (searchContext ? `${base}\n\n${searchContext}` : base);
```

替换为：

```ts
  // 联网研究(searchResearch):带工具的 agent 自主检索,产出研究备忘录
  // 失败时优雅降级:不中断流水线,只是生成内容不含研究资料
  let researchMemo = "";
  if (deps.researchEnabled) {
    const researchSystem = buildSystem(deps.loadPrompt, "search-research", false);
    const researchUser = `${userInput}\n\n【已确认的意图与一级话题】\n${outline1}`;
    try {
      researchMemo = await deps.runRole("searchResearch", { system: researchSystem, user: researchUser });
    } catch (e) {
      console.error(`  ⚠ 联网研究失败,降级为纯模型作答:${(e as Error).message}`);
      researchMemo = "";
    }
  }
  // 工具函数:有研究备忘录时追加到 base 末尾;没有时原样返回
  const withSearch = (base: string) => (researchMemo ? `${base}\n\n${researchMemo}` : base);
```

（`withSearch` 名称保留不变，下游 `orgUser` / `genUser` 已用它，无需再改。）

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/orchestrator.test.ts`
Expected: PASS

- [ ] **Step 6: 类型检查 + 提交**

Run: `npm run typecheck`
Expected: server.ts / cli.ts 会因为 `deps.search` 已删、`researchEnabled` 未传而报错 —— 这是预期的，将在 Task 5/6 修复。如需让 typecheck 暂时全绿再提交，可先提交本任务，Task 5/6 紧随其后。

```bash
git add src/orchestrator.ts tests/orchestrator.test.ts
git commit -m "feat: orchestrator uses searchResearch role instead of one-shot search"
```

---

### Task 5: server.ts 装配（工具执行器 + runRole 分派）

**Files:**
- Modify: `src/server.ts`

本任务是集成装配，无单元测试；用手动验证（Step 5）确认端到端可用。

- [ ] **Step 1: 更新 import**

`src/server.ts` 顶部，把 agentRunner 与 tavily 的 import 改为：

```ts
import { runAgent, runAgentWithTools, type ModelClient, type ToolDef, type ToolExecutor } from "./agentRunner.js";
```

```ts
import { tavilySearch, tavilyExtract, formatSearchContext } from "./tools/tavily.js";
```

- [ ] **Step 2: ROLE_LABEL 加入 searchResearch**

`src/server.ts` 的 `ROLE_LABEL` 映射（`Record<AgentRole, string>`）加入一行：

```ts
const ROLE_LABEL: Record<AgentRole, string> = {
  questionAnalysis:    "问题分析",
  searchResearch:      "联网研究",
  contentOrganization: "内容组织",
  contentGeneration:   "内容生成",
  contentReview:       "内容审核",
  diagramSvg:          "SVG 作图",
  incrementalMerge:    "增量合并",
  distiller:           "沉淀",
};
```

- [ ] **Step 3: 在 buildDeps 内定义工具与执行器，并让 runRole 分派**

在 `src/server.ts` 的 `buildDeps` 内，`const sdk = new Anthropic(...)` 之后、`runRole` 定义之前，插入工具定义与执行器：

```ts
  // 联网研究工具(searchResearch 角色用)
  const SEARCH_TOOLS: ToolDef[] = [
    {
      name: "web_search",
      description: "搜索网页，返回若干条标题、URL 和摘要（不含正文）。用它发现资料来源。",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索查询词" },
          max_results: { type: "integer", description: "返回条数，默认 5" },
        },
        required: ["query"],
      },
    },
    {
      name: "read_page",
      description: "读取指定 URL 的网页正文全文。用它深读值得精读的来源。",
      input_schema: {
        type: "object",
        properties: { url: { type: "string", description: "要读取的网页 URL" } },
        required: ["url"],
      },
    },
  ];

  const searchExecutor: ToolExecutor = async (name, rawInput) => {
    const args = (rawInput ?? {}) as { query?: string; url?: string; max_results?: number };
    if (!baseURL) return "联网不可用（未配置网关地址）";
    if (name === "web_search") {
      const r = await tavilySearch(args.query ?? "", { base: baseURL, apiKey, maxResults: args.max_results ?? 5 });
      return formatSearchContext(r);
    }
    if (name === "read_page") {
      return await tavilyExtract(args.url ?? "", { base: baseURL, apiKey });
    }
    return `未知工具：${name}`;
  };
```

然后在 `runRole` 内部，把这一行：

```ts
    const result = await runAgent(input, cfg, wrappedClient);
```

替换为按角色分派：

```ts
    const result = role === "searchResearch"
      ? await runAgentWithTools(input, cfg, wrappedClient, SEARCH_TOOLS, searchExecutor)
      : await runAgent(input, cfg, wrappedClient);
```

- [ ] **Step 4: 用 researchEnabled 替换 search 依赖**

在 `buildDeps` 中删除原来的 `search` 定义块：

```ts
  const search =
    process.env.NO_SEARCH === "1" || !baseURL
      ? undefined
      : async (query: string) => {
          const r = await tavilySearch(query, { base: baseURL, apiKey });
          return formatSearchContext(r);
        };
```

替换为：

```ts
  const researchEnabled = process.env.NO_SEARCH !== "1" && !!baseURL;
```

并把 `buildDeps` 的 `return { ... }` 里的 `search,` 改为 `researchEnabled,`：

```ts
  return { loadPrompt, runRole, gate, publish, researchEnabled, dedup, updateIndex, onReviewFeedback, patchDocDiagrams, reviewMaxRetries: appSettings.maxReviewRetries };
```

- [ ] **Step 5: 类型检查 + 手动端到端验证**

Run: `npm run typecheck`
Expected: 通过

手动验证（需要 settings.json 里已填好 API Key 和网关地址）：

```bash
npm run serve
```

在前端发起一次真实运行（一个需要联网的主题，如"2025 年 React 服务端组件最佳实践"），观察：
1. 进度里出现「联网研究」步骤（step_start / progress 事件）。
2. 该步骤耗时明显（多轮工具调用），最终成稿引用了较新的资料。
3. 若网关**不支持工具调用**（返回 4xx/关于 tools 的报错），说明命中风险项：此时把 `agents.config.json` 的 `searchResearch` 暂时留空、并在 orchestrator 里临时关掉 `researchEnabled` 回退到无研究流程，然后反馈给计划作者调整降级策略。

- [ ] **Step 6: 提交**

```bash
git add src/server.ts
git commit -m "feat: wire searchResearch tool loop into server runRole"
```

---

### Task 6: cli.ts 装配（与 server 对齐）

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: 更新 import**

`src/cli.ts` 顶部，把 agentRunner 与 tavily 的 import 改为：

```ts
import { runAgent, runAgentWithTools, type ModelClient, type ToolDef, type ToolExecutor } from "./agentRunner.js";
```

```ts
import { tavilySearch, tavilyExtract, formatSearchContext } from "./tools/tavily.js";
```

- [ ] **Step 2: runRole 分派到工具循环**

`src/cli.ts` 的 `runRole` 定义（约在文件 96–107 行）。先在 `runRole` 之前定义与 server.ts 相同的 `SEARCH_TOOLS` 和 `searchExecutor`（复制 Task 5 Step 3 的两段代码，注意 cli.ts 中承载 base/apiKey 的变量名——若 cli.ts 用的是 `baseURL`/`apiKey` 之外的名字，按实际变量名替换 `searchExecutor` 内的引用）。

然后把 `runRole` 里的：

```ts
    return runAgent(input, cfg, client);
```

替换为：

```ts
    return role === "searchResearch"
      ? runAgentWithTools(input, cfg, client, SEARCH_TOOLS, searchExecutor)
      : runAgent(input, cfg, client);
```

- [ ] **Step 3: researchEnabled 替换 search 依赖**

`src/cli.ts` 中删除原 `search` 定义（约 111–120 行，`const search = ... NO_SEARCH ...`），改为：

```ts
  const researchEnabled = process.env.NO_SEARCH !== "1" && !!baseURL;
```

（若 cli.ts 中网关地址变量不叫 `baseURL`，用实际名字。）

然后把两处 `runPipeline(..., { ... search, ... })` 里的 `search,` 改为 `researchEnabled,`（文件中约有两处：主运行与 split 子运行；grep `search,` 定位）。

- [ ] **Step 4: 类型检查 + 全量测试**

Run: `npm run typecheck && npm test`
Expected: 全绿

- [ ] **Step 5: 提交**

```bash
git add src/cli.ts
git commit -m "feat: wire searchResearch tool loop into cli runRole"
```

---

## 验收标准

- `npm test` 全绿；`npm run typecheck` 通过。
- 前端"模型配置"面板出现「联网研究」一行，可独立配置 model/effort/maxTokens/thinking。
- 一次真实运行中，「联网研究」作为独立步骤出现在进度里，成稿事实密度较改造前明显提升。
- 联网不可用（无网关 / NO_SEARCH=1 / 工具报错）时，流水线优雅降级、仍能出稿。

## 未包含（YAGNI）

- 不做 questionAnalysis 的框定/元数据拆分（已决定只升级模型）。
- 不做研究备忘录的持久化展示 UI（备忘录仅作为中间上下文，不单独存库）。
- 不做工具调用的前端实时可视化（沿用现有 step_start/progress 粒度）。
