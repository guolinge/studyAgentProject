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

  // ANTHROPIC_API_KEY 必填;ANTHROPIC_BASE_URL 可选(设了就走公司网关,不设走官方)
  const sdk = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
  });
  // 用 streaming + finalMessage:长输出(maxTokens 大)时官方 SDK 会拒绝非流式请求。
  // .finalMessage() 返回的 Message 结构与 create() 一致,故 agentRunner 无需改动。
  const client: ModelClient = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createMessage: (params) => sdk.messages.stream(params as any).finalMessage() as never,
  };

  // 没有 lark-cli(如本机)时,设 LARK_DRY_RUN=1 跳过飞书写入,只打印将写入的 XML
  const dryRun = process.env.LARK_DRY_RUN === "1";

  console.error(`[1/2] 正在生成(model=${genCfg.model}, effort=${genCfg.effort})…`);
  const result = await runSkeleton(userInput, {
    loadPrompt,
    generate: (input) => runAgent(input, genCfg, client),
    publish: (xml) => {
      if (dryRun) {
        console.error("[2/2] (dry-run)跳过飞书写入,打印将写入的 XML:\n");
        console.log(xml);
        return Promise.resolve("(dry-run:未写入飞书)");
      }
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
