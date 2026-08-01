import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { loadConfig, resolveAgentConfig } from "./config.js";
import { loadPrompt } from "./prompts.js";
import { runAgent, type ModelClient } from "./agentRunner.js";
import { larkCreateDoc } from "./tools/lark.js";
import { runPipeline } from "./orchestrator.js";
import { createReadlineAsker } from "./io.js";
import type { AgentInput, AgentRole } from "./types.js";

const ROLE_LABEL: Record<AgentRole, string> = {
  questionAnalysis: "问题分析",
  contentOrganization: "内容组织",
  contentGeneration: "内容生成",
  contentReview: "内容审核",
  distiller: "沉淀",
};

async function main() {
  const userInput = process.argv.slice(2).join(" ").trim();
  if (!userInput) {
    console.error('用法:npm start -- "你想搞懂的知识点,例如:pnpm 原理是什么"');
    process.exit(1);
  }

  const config = loadConfig();

  // ANTHROPIC_API_KEY 必填;ANTHROPIC_BASE_URL 可选(设了就走公司网关,不设走官方)
  const sdk = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
  });
  // 用 streaming + finalMessage:长输出(maxTokens 大)时官方 SDK 会拒绝非流式请求。
  const client: ModelClient = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createMessage: (params) => sdk.messages.stream(params as any).finalMessage() as never,
  };

  const dryRun = process.env.LARK_DRY_RUN === "1";

  // 按角色取配置调 runAgent(复用同一 streaming client)
  const runRole = (role: AgentRole, input: AgentInput) => {
    const cfg = resolveAgentConfig(config, role);
    console.error(`  → [${ROLE_LABEL[role]}] 运行中(model=${cfg.model}, effort=${cfg.effort})…`);
    return runAgent(input, cfg, client);
  };

  const result = await runPipeline(userInput, {
    loadPrompt,
    runRole,
    gate: createReadlineAsker(),
    publish: (markdown) => {
      if (dryRun) {
        console.error("\n(dry-run)跳过飞书写入,打印将导入的 Markdown:\n");
        console.log(markdown);
        return Promise.resolve("(dry-run:未写入飞书)");
      }
      console.error("\n正在写入飞书…");
      return larkCreateDoc(markdown, "markdown");
    },
  });

  console.log("\n✅ 已写入飞书:", result.url);
}

main().catch((err) => {
  console.error("❌ 失败:", err.message);
  process.exit(1);
});
