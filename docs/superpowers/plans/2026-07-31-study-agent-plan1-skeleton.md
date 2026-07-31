# 学习型知识 Agent — Plan 1:骨架跑通(Walking Skeleton)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭出一条最薄的端到端链路——命令行输入一个知识点 → agent 运行器按 `style-rules.md` 生成一篇答案 → 写进飞书文档并返回 URL——并把配置加载、prompt 加载、飞书工具三块地基做扎实、可测。

**Architecture:** TypeScript ESM 应用,自托管 Claude API loop。每个 agent = 一次带专属 system prompt 的 `client.messages.create()`,参数由 `agents.config.json` 驱动。飞书通过 `child_process` 调用本地已登录的 `lark-cli`。纯逻辑(配置合并、argv 构造、编排顺序)用 vitest 做单元测试,API 与 lark 调用通过依赖注入 mock。

**Tech Stack:** Node.js 20+、TypeScript、ESM、`@anthropic-ai/sdk`、`zod`(配置校验)、`dotenv`、`vitest`(测试)、本地 `lark-cli`。

---

## File Structure

| 文件 | 职责 |
|---|---|
| `package.json` / `tsconfig.json` / `vitest.config.ts` | 工程脚手架 |
| `.env.example` | 声明 `ANTHROPIC_API_KEY` |
| `agents.config.json` | 每个 agent 的模型参数(defaults + 覆盖) |
| `prompts/style-rules.md` | 惊艳规则/偏好(单一真相源) |
| `prompts/content-generation.md` | 生成角色 prompt |
| `src/types.ts` | 共享类型:角色名、已解析配置、agent 入参 |
| `src/config.ts` | `loadConfig()`:读 JSON、zod 校验、defaults 合并 |
| `src/prompts.ts` | `loadPrompt()`:读 `prompts/*.md` |
| `src/agentRunner.ts` | `runAgent()`:按配置调 `messages.create`(注入 client 可 mock) |
| `src/tools/lark.ts` | `buildCreateDocArgs()`(纯) + `larkCreateDoc()`(注入 exec 可 mock) |
| `src/orchestrator.ts` | `runSkeleton()`:输入 → 生成 → 写飞书(注入 runAgent / lark) |
| `src/cli.ts` | 命令行入口:读参数、装配真实依赖、调 orchestrator、打印 URL |
| `tests/*.test.ts` | 对应单元测试 |

---

## Task 1: 工程脚手架

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.env.example`
- Create: `src/index-smoke.ts`(临时冒烟文件,Task 末尾删除)
- Test: `tests/smoke.test.ts`

- [ ] **Step 1: 写 `package.json`**

```json
{
  "name": "study-agent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "start": "node --import tsx src/cli.ts"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.68.0",
    "dotenv": "^16.4.5",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

> 版本号是当前可用的稳定版起点;执行时 `npm install` 会解析到兼容的最新补丁版。若某包报版本不存在,用 `npm view <pkg> version` 查最新可用版再填。

- [ ] **Step 2: 写 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: 写 `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: 写 `.env.example`**

```
# 复制为 .env 并填入你的 key
ANTHROPIC_API_KEY=sk-ant-...
```

- [ ] **Step 5: 写冒烟实现 `src/index-smoke.ts`**

```ts
export function smoke(): string {
  return "ok";
}
```

- [ ] **Step 6: 写冒烟测试 `tests/smoke.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { smoke } from "../src/index-smoke.js";

describe("smoke", () => {
  it("returns ok", () => {
    expect(smoke()).toBe("ok");
  });
});
```

- [ ] **Step 7: 安装依赖并跑测试**

Run: `npm install && npm test`
Expected: 1 passed(`tests/smoke.test.ts`)。若 `npm install` 网络失败,重试;仍失败则停下报告,不要继续。

- [ ] **Step 8: 删除冒烟文件、提交**

```bash
rm src/index-smoke.ts tests/smoke.test.ts
git add -A
git commit -m "chore: TypeScript + vitest 工程脚手架"
```

---

## Task 2: 共享类型

**Files:**
- Create: `src/types.ts`
- Test:(无独立测试,后续任务的测试覆盖它)

- [ ] **Step 1: 写 `src/types.ts`**

```ts
// agent 角色名(与 agents.config.json 的 key、prompts 文件名对应)
export type AgentRole =
  | "questionAnalysis"
  | "contentOrganization"
  | "contentGeneration"
  | "contentReview"
  | "distiller";

// 配置文件里单个 agent 可覆盖的字段(全部可选)
export interface AgentConfigOverride {
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens?: number;
  thinking?: "adaptive" | "disabled";
}

// defaults 必须字段齐全
export interface AgentDefaults {
  model: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens: number;
  thinking: "adaptive" | "disabled";
}

// defaults 合并覆盖后的最终配置(字段齐全)
export type ResolvedAgentConfig = AgentDefaults;

// agent 运行入参
export interface AgentInput {
  system: string; // system prompt
  user: string; // 用户内容
}
```

- [ ] **Step 2: typecheck 通过并提交**

Run: `npm run typecheck`
Expected: 无错误。

```bash
git add src/types.ts
git commit -m "feat: 共享类型定义"
```

---

## Task 3: 配置加载与合并

**Files:**
- Create: `agents.config.json`
- Create: `src/config.ts`
- Test: `tests/config.test.ts`

- [ ] **Step 1: 写 `agents.config.json`**

```json
{
  "defaults": { "model": "claude-opus-4-8", "effort": "high", "maxTokens": 16000, "thinking": "adaptive" },
  "agents": {
    "questionAnalysis":    { "effort": "medium" },
    "contentOrganization": { "effort": "high" },
    "contentGeneration":   { "effort": "high", "maxTokens": 32000 },
    "contentReview":       { "model": "claude-haiku-4-5", "effort": "low" },
    "distiller":           { "effort": "medium" }
  }
}
```

- [ ] **Step 2: 写失败测试 `tests/config.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { resolveAgentConfig, ConfigSchema } from "../src/config.js";

const raw = {
  defaults: { model: "claude-opus-4-8", effort: "high", maxTokens: 16000, thinking: "adaptive" },
  agents: {
    contentGeneration: { effort: "high", maxTokens: 32000 },
    contentReview: { model: "claude-haiku-4-5", effort: "low" },
  },
} as const;

describe("resolveAgentConfig", () => {
  it("merges override onto defaults", () => {
    const cfg = ConfigSchema.parse(raw);
    const gen = resolveAgentConfig(cfg, "contentGeneration");
    expect(gen).toEqual({
      model: "claude-opus-4-8",
      effort: "high",
      maxTokens: 32000, // 覆盖
      thinking: "adaptive",
    });
  });

  it("returns pure defaults when no override present", () => {
    const cfg = ConfigSchema.parse(raw);
    const q = resolveAgentConfig(cfg, "questionAnalysis");
    expect(q).toEqual(raw.defaults);
  });

  it("override model wins", () => {
    const cfg = ConfigSchema.parse(raw);
    expect(resolveAgentConfig(cfg, "contentReview").model).toBe("claude-haiku-4-5");
  });

  it("rejects an unknown effort value", () => {
    expect(() =>
      ConfigSchema.parse({ ...raw, defaults: { ...raw.defaults, effort: "turbo" } }),
    ).toThrow();
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL(`src/config.js` 尚不存在 / 导出未定义)。

- [ ] **Step 4: 写 `src/config.ts`**

```ts
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { AgentRole, ResolvedAgentConfig } from "./types.js";

const EffortSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);
const ThinkingSchema = z.enum(["adaptive", "disabled"]);

const DefaultsSchema = z.object({
  model: z.string().min(1),
  effort: EffortSchema,
  maxTokens: z.number().int().positive(),
  thinking: ThinkingSchema,
});

const OverrideSchema = z.object({
  model: z.string().min(1).optional(),
  effort: EffortSchema.optional(),
  maxTokens: z.number().int().positive().optional(),
  thinking: ThinkingSchema.optional(),
});

export const ConfigSchema = z.object({
  defaults: DefaultsSchema,
  agents: z.record(z.string(), OverrideSchema),
});

export type Config = z.infer<typeof ConfigSchema>;

/** defaults 合并某角色的覆盖项,得到字段齐全的最终配置 */
export function resolveAgentConfig(cfg: Config, role: AgentRole): ResolvedAgentConfig {
  return { ...cfg.defaults, ...(cfg.agents[role] ?? {}) };
}

/** 从磁盘读取并校验配置文件 */
export function loadConfig(path = "agents.config.json"): Config {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return ConfigSchema.parse(raw);
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/config.test.ts`
Expected: 4 passed。

- [ ] **Step 6: 提交**

```bash
git add agents.config.json src/config.ts tests/config.test.ts
git commit -m "feat: 模型参数配置加载与 defaults 合并"
```

---

## Task 4: prompt 文件加载

**Files:**
- Create: `prompts/style-rules.md`
- Create: `prompts/content-generation.md`
- Create: `src/prompts.ts`
- Test: `tests/prompts.test.ts`

- [ ] **Step 1: 写 `prompts/style-rules.md`**(惊艳规则,初版;后续由 Distiller 进化)

```markdown
# 回答风格规则(single source of truth)

面向使用者:前端工程师(懂后端),目标成为架构师。回答计算机知识时严格遵循:

## 必须
- **从问题到设计的推导**:讲透"为什么这么设计",包含被否决的替代方案(why not X),而非只讲"它是什么"。
- **跨界心智模型/类比**:把新概念连到使用者已知的技术(git、http、文件系统等),给一个"一下就通"的模型。禁止生活化比喻。
- **图**:能用图讲清的用图(架构/流程/时序/数据流/关系)。
- **代码**:用 JS/TS 或伪代码,且每段带注释;不要 C/Python;不要默认读者看得懂晦涩处。
- **标注主流 vs 过时**:过时方案要明确标注,避免误导。

## 禁止
- 幼稚生活化例子(厨房厨师、老师医生、银行、排队等)。
- 啰嗦;要点篇幅与重要性匹配。

## 语言
- 中文回答;技术术语用行业通用写法。
```

- [ ] **Step 2: 写 `prompts/content-generation.md`**(生成角色,初版)

```markdown
# 角色:内容生成

你是一名资深技术作者,为使用者生成一篇计算机知识讲解文档。

严格遵循下面的《回答风格规则》。围绕使用者给定的知识点,产出一篇结构清晰、有推导、有类比、有(必要时)代码与图示指令的讲解。

输出为 Markdown。图不要自己画,凡需配图处写一行 `【配图指令:<描述你要画的图>】`,由后续的飞书文档 agent 去画。

---

（下面会自动附上《回答风格规则》全文)
```

- [ ] **Step 3: 写失败测试 `tests/prompts.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { loadPrompt } from "../src/prompts.js";

describe("loadPrompt", () => {
  it("loads style-rules content", () => {
    const text = loadPrompt("style-rules");
    expect(text).toContain("回答风格规则");
    expect(text.length).toBeGreaterThan(50);
  });

  it("loads content-generation content", () => {
    const text = loadPrompt("content-generation");
    expect(text).toContain("内容生成");
  });

  it("throws a clear error for a missing prompt", () => {
    expect(() => loadPrompt("does-not-exist")).toThrow(/prompt.*does-not-exist/i);
  });
});
```

- [ ] **Step 4: 跑测试确认失败**

Run: `npx vitest run tests/prompts.test.ts`
Expected: FAIL(`src/prompts.js` 不存在)。

- [ ] **Step 5: 写 `src/prompts.ts`**

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PROMPTS_DIR = "prompts";

/** 读取 prompts/<name>.md 的全文 */
export function loadPrompt(name: string, dir = PROMPTS_DIR): string {
  const path = join(dir, `${name}.md`);
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new Error(`无法加载 prompt "${name}"(期望路径:${path})`);
  }
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run tests/prompts.test.ts`
Expected: 3 passed。

- [ ] **Step 7: 提交**

```bash
git add prompts/style-rules.md prompts/content-generation.md src/prompts.ts tests/prompts.test.ts
git commit -m "feat: prompt/rules 文件加载 + 初版 style-rules 与生成角色"
```

---

## Task 5: agent 运行器(封装 messages.create,可 mock)

**Files:**
- Create: `src/agentRunner.ts`
- Test: `tests/agentRunner.test.ts`

设计:`runAgent` 接收一个最小的 `ModelClient` 接口(只要一个 `createMessage` 方法),真实实现包 `@anthropic-ai/sdk`,测试里传 fake。这样无需网络即可测"配置如何映射成 API 参数"和"如何取回文本"。

- [ ] **Step 1: 写失败测试 `tests/agentRunner.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { runAgent, type ModelClient } from "../src/agentRunner.js";
import type { ResolvedAgentConfig } from "../src/types.js";

const cfg: ResolvedAgentConfig = {
  model: "claude-opus-4-8",
  effort: "high",
  maxTokens: 32000,
  thinking: "adaptive",
};

describe("runAgent", () => {
  it("maps config to API params and returns concatenated text", async () => {
    const createMessage = vi.fn().mockResolvedValue({
      content: [
        { type: "thinking", thinking: "..." },
        { type: "text", text: "第一段。" },
        { type: "text", text: "第二段。" },
      ],
    });
    const client: ModelClient = { createMessage };

    const out = await runAgent(
      { system: "你是助手", user: "讲讲 pnpm" },
      cfg,
      client,
    );

    expect(out).toBe("第一段。第二段。");
    expect(createMessage).toHaveBeenCalledOnce();
    const params = createMessage.mock.calls[0][0];
    expect(params.model).toBe("claude-opus-4-8");
    expect(params.max_tokens).toBe(32000);
    expect(params.system).toBe("你是助手");
    expect(params.thinking).toEqual({ type: "adaptive" });
    expect(params.output_config).toEqual({ effort: "high" });
    expect(params.messages).toEqual([{ role: "user", content: "讲讲 pnpm" }]);
  });

  it("omits thinking param when disabled", async () => {
    const createMessage = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "x" }] });
    await runAgent({ system: "s", user: "u" }, { ...cfg, thinking: "disabled" }, { createMessage });
    const params = createMessage.mock.calls[0][0];
    expect(params.thinking).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/agentRunner.test.ts`
Expected: FAIL(`src/agentRunner.js` 不存在)。

- [ ] **Step 3: 写 `src/agentRunner.ts`**

```ts
import type { AgentInput, ResolvedAgentConfig } from "./types.js";

// 只依赖我们需要的最小接口,便于测试注入 fake
export interface ModelClient {
  createMessage(params: Record<string, unknown>): Promise<{ content: Array<{ type: string; text?: string }> }>;
}

/** 按配置把一次 agent 调用映射为 messages.create 参数,返回拼接后的文本 */
export async function runAgent(
  input: AgentInput,
  cfg: ResolvedAgentConfig,
  client: ModelClient,
): Promise<string> {
  const params: Record<string, unknown> = {
    model: cfg.model,
    max_tokens: cfg.maxTokens,
    system: input.system,
    output_config: { effort: cfg.effort },
    messages: [{ role: "user", content: input.user }],
  };
  if (cfg.thinking === "adaptive") {
    params.thinking = { type: "adaptive" };
  }
  const resp = await client.createMessage(params);
  return resp.content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/agentRunner.test.ts`
Expected: 2 passed。

- [ ] **Step 5: 提交**

```bash
git add src/agentRunner.ts tests/agentRunner.test.ts
git commit -m "feat: agent 运行器(配置→API 参数映射,可注入 mock)"
```

---

## Task 6: 飞书写入工具(argv 构造纯函数 + exec 封装)

**Files:**
- Create: `src/tools/lark.ts`
- Test: `tests/lark.test.ts`

设计:把"构造 lark-cli argv"(纯函数,可精确断言)与"实际执行"(注入一个 `runner` 函数,测试里 mock)分开。Plan 1 只需要"创建文档"这一个能力。

- [ ] **Step 1: 写失败测试 `tests/lark.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { buildCreateDocArgs, larkCreateDoc } from "../src/tools/lark.js";

describe("buildCreateDocArgs", () => {
  it("builds docs +create argv with content flag", () => {
    const args = buildCreateDocArgs("<title>T</title><p>hi</p>");
    expect(args).toEqual(["docs", "+create", "--content", "<title>T</title><p>hi</p>", "--as", "user"]);
  });
});

describe("larkCreateDoc", () => {
  it("parses the doc URL out of lark-cli JSON stdout", async () => {
    const runner = vi.fn().mockResolvedValue(
      JSON.stringify({ ok: true, data: { document: { url: "https://futu.feishu.cn/docx/ABC123" } } }),
    );
    const url = await larkCreateDoc("<title>T</title>", runner);
    expect(url).toBe("https://futu.feishu.cn/docx/ABC123");
    expect(runner).toHaveBeenCalledWith("lark-cli", buildCreateDocArgs("<title>T</title>"));
  });

  it("throws when lark-cli reports failure", async () => {
    const runner = vi.fn().mockResolvedValue(JSON.stringify({ ok: false, error: { message: "boom" } }));
    await expect(larkCreateDoc("<title>T</title>", runner)).rejects.toThrow(/boom/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/lark.test.ts`
Expected: FAIL(`src/tools/lark.js` 不存在)。

- [ ] **Step 3: 写 `src/tools/lark.ts`**

```ts
import { execFile } from "node:child_process";

/** 构造 `lark-cli docs +create` 的 argv(不含 lark-cli 本身) */
export function buildCreateDocArgs(contentXml: string): string[] {
  return ["docs", "+create", "--content", contentXml, "--as", "user"];
}

// 注入型执行器:给定命令与参数,返回 stdout 字符串
export type CliRunner = (cmd: string, args: string[]) => Promise<string>;

/** 默认执行器:真正 spawn lark-cli */
export const defaultRunner: CliRunner = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${cmd} 执行失败:${stderr || err.message}`));
      resolve(stdout);
    });
  });

/** 创建飞书文档,返回文档 URL */
export async function larkCreateDoc(contentXml: string, runner: CliRunner = defaultRunner): Promise<string> {
  const stdout = await runner("lark-cli", buildCreateDocArgs(contentXml));
  const parsed = JSON.parse(stdout) as {
    ok?: boolean;
    data?: { document?: { url?: string } };
    error?: { message?: string };
  };
  if (!parsed.ok) {
    throw new Error(`飞书创建文档失败:${parsed.error?.message ?? "unknown"}`);
  }
  const url = parsed.data?.document?.url;
  if (!url) throw new Error("飞书返回中缺少 document.url");
  return url;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/lark.test.ts`
Expected: 3 passed。

- [ ] **Step 5: 提交**

```bash
git add src/tools/lark.ts tests/lark.test.ts
git commit -m "feat: 飞书写入工具(argv 构造 + 创建文档,可注入 runner)"
```

---

## Task 7: 编排器骨架(输入→生成→写飞书)

**Files:**
- Create: `src/orchestrator.ts`
- Test: `tests/orchestrator.test.ts`

设计:`runSkeleton` 依赖注入 `generate`(生成文本)与 `publish`(写飞书返回 URL)两个函数,便于用 fake 精确测"编排顺序与数据流",不碰网络/子进程。它负责:拼 system(生成角色 prompt + style-rules)、把生成的 Markdown 包成飞书可接受的 XML、调 publish。

- [ ] **Step 1: 写失败测试 `tests/orchestrator.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { runSkeleton, markdownToDocXml, type SkeletonDeps } from "../src/orchestrator.js";

describe("markdownToDocXml", () => {
  it("wraps a title and keeps body as a paragraph", () => {
    const xml = markdownToDocXml("pnpm 原理", "正文一段");
    expect(xml).toContain("<title>pnpm 原理</title>");
    expect(xml).toContain("正文一段");
  });

  it("escapes XML-significant chars in the title", () => {
    const xml = markdownToDocXml("A & B < C", "x");
    expect(xml).toContain("<title>A &amp; B &lt; C</title>");
  });
});

describe("runSkeleton", () => {
  it("builds system from role prompt + style rules, generates, then publishes", async () => {
    const generate = vi.fn().mockResolvedValue("# pnpm 原理\n\n正文");
    const publish = vi.fn().mockResolvedValue("https://futu.feishu.cn/docx/XYZ");
    const deps: SkeletonDeps = {
      generate,
      publish,
      loadPrompt: (name) => (name === "content-generation" ? "ROLE" : "RULES"),
    };

    const result = await runSkeleton("pnpm 原理是什么", deps);

    expect(result.url).toBe("https://futu.feishu.cn/docx/XYZ");
    // system 拼接了角色 prompt 与规则
    const sys = generate.mock.calls[0][0].system as string;
    expect(sys).toContain("ROLE");
    expect(sys).toContain("RULES");
    // 用户内容是原始输入
    expect(generate.mock.calls[0][0].user).toBe("pnpm 原理是什么");
    // publish 收到的是包了 <title> 的 XML
    expect(publish.mock.calls[0][0]).toContain("<title>");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/orchestrator.test.ts`
Expected: FAIL(`src/orchestrator.js` 不存在)。

- [ ] **Step 3: 写 `src/orchestrator.ts`**

```ts
import type { AgentInput } from "./types.js";

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 从生成的 Markdown 里取首个 # 标题作为文档标题(取不到就用输入回退) */
function extractTitle(markdown: string, fallback: string): string {
  const m = markdown.match(/^#\s+(.+)$/m);
  return (m?.[1] ?? fallback).trim();
}

/**
 * 把生成结果包成飞书 docs +create 接受的最小 XML。
 * Plan 1 只做:标题 + 正文塞进一个段落(正文按原样保留,换行转 <br/>)。
 * (富结构化/画图在 Plan 2/3 增强)
 */
export function markdownToDocXml(title: string, body: string): string {
  const safeTitle = escapeXml(title);
  const safeBody = escapeXml(body).replace(/\n/g, "<br/>");
  return `<title>${safeTitle}</title><p>${safeBody}</p>`;
}

export interface SkeletonDeps {
  generate: (input: AgentInput) => Promise<string>;
  publish: (contentXml: string) => Promise<string>;
  loadPrompt: (name: string) => string;
}

export interface SkeletonResult {
  url: string;
  markdown: string;
}

/** 骨架链路:输入 → 生成(角色prompt+规则) → 包成飞书 XML → 写飞书 → 返回 URL */
export async function runSkeleton(userInput: string, deps: SkeletonDeps): Promise<SkeletonResult> {
  const role = deps.loadPrompt("content-generation");
  const rules = deps.loadPrompt("style-rules");
  const system = `${role}\n\n---\n\n${rules}`;

  const markdown = await deps.generate({ system, user: userInput });
  const title = extractTitle(markdown, userInput);
  const xml = markdownToDocXml(title, markdown);
  const url = await deps.publish(xml);
  return { url, markdown };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/orchestrator.test.ts`
Expected: 4 passed。

- [ ] **Step 5: 提交**

```bash
git add src/orchestrator.ts tests/orchestrator.test.ts
git commit -m "feat: 编排器骨架(输入→生成→包 XML→写飞书)"
```

---

## Task 8: CLI 入口(装配真实依赖)

**Files:**
- Create: `src/cli.ts`
- Test:(入口做集成装配,不写单测;通过手动运行验证)

- [ ] **Step 1: 写 `src/cli.ts`**

```ts
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { loadConfig, resolveAgentConfig } from "./config.js";
import { loadPrompt } from "./prompts.js";
import { runAgent, type ModelClient } from "./agentRunner.js";
import { larkCreateDoc } from "./tools/lark.js";
import { runSkeleton } from "./orchestrator.js";

async function main() {
  const userInput = process.argv.slice(2).join(" ").trim();
  if (!userInput) {
    console.error('用法:npm start -- "你想搞懂的知识点,例如:pnpm 原理是什么"');
    process.exit(1);
  }

  const config = loadConfig();
  const genCfg = resolveAgentConfig(config, "contentGeneration");

  const sdk = new Anthropic(); // 读 ANTHROPIC_API_KEY
  const client: ModelClient = {
    createMessage: (params) => sdk.messages.create(params as never) as never,
  };

  console.error(`[1/2] 正在生成(model=${genCfg.model}, effort=${genCfg.effort})…`);
  const result = await runSkeleton(userInput, {
    loadPrompt,
    generate: (input) => runAgent(input, genCfg, client),
    publish: (xml) => {
      console.error("[2/2] 正在写入飞书…");
      return larkCreateDoc(xml);
    },
  });

  console.log("\n✅ 已写入飞书:", result.url);
}

main().catch((err) => {
  console.error("❌ 失败:", err.message);
  process.exit(1);
});
```

- [ ] **Step 2: typecheck 通过**

Run: `npm run typecheck`
Expected: 无错误。若 SDK 的 `messages.create` 参数类型与我们的 `Record<string, unknown>` 冲突,已用 `as never` 桥接;若仍报错,把 `client.createMessage` 的实现改为 `sdk.messages.create(params as any)` 并加一行 `// eslint-disable`(仅入口装配处允许)。

- [ ] **Step 3: 全量测试通过**

Run: `npm test`
Expected: 所有测试 passed(config 4 + prompts 3 + agentRunner 2 + lark 3 + orchestrator 4)。

- [ ] **Step 4: 手动端到端验证(需真实 key + 已登录 lark-cli)**

前置:`cp .env.example .env` 并填入 `ANTHROPIC_API_KEY`;确认 `lark-cli auth status` 为已登录 user 身份。

Run: `npm start -- "pnpm 原理是什么"`
Expected:终端最后打印 `✅ 已写入飞书: https://futu.feishu.cn/docx/...`;打开该 URL 能看到一篇按 style-rules 风格生成的文档(有推导/类比/代码,无幼稚比喻)。

> 若这一步因网络/额度/授权失败,记录失败信息并报告——单元测试已保证代码逻辑正确,此步是真实链路联调。

- [ ] **Step 5: 提交**

```bash
git add src/cli.ts
git commit -m "feat: CLI 入口——端到端跑通 输入→生成→写飞书"
```

---

## 完成标准(Plan 1 Done)

- [ ] `npm test` 全绿(16 个测试)。
- [ ] `npm run typecheck` 无错误。
- [ ] `npm start -- "<某知识点>"` 能在飞书生成一篇符合 style-rules 风格的文档并返回 URL。
- [ ] 改 `agents.config.json` 的 `contentGeneration.model` / `effort`,重跑能看到行为变化(验证配置化生效)。
- [ ] 改 `prompts/style-rules.md`,重跑能看到风格变化(验证 prompt 文件化生效)。

---

## 下一步

Plan 1 落地后,基于真实代码再写:
- **Plan 2**:问题分析(含查重:调 `lark-cli drive +search`)、内容组织(三级大纲 + 表达形式菜单)、内容审核、门1/门2 的命令行交互、飞书块级/画图增强(内联 mermaid + 清洁化,见设计文档附录 A)。
- **Plan 3**:沉淀 agent(Distiller)——收集门反馈 → 蒸馏候选规则 → 批准 → 写回 `prompts/*.md` + git commit。
