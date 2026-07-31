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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: ModelClient = {
    createMessage: (params) => sdk.messages.create(params as any) as never,
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
