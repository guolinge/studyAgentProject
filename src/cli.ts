import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { loadConfig, resolveAgentConfig } from "./config.js";
import { loadPrompt } from "./prompts.js";
import { runAgent, type ModelClient } from "./agentRunner.js";
import { larkCreateDoc } from "./tools/lark.js";
import { tavilySearch, formatSearchContext } from "./tools/tavily.js";
import { runPipeline } from "./orchestrator.js";
import { createReadlineAsker } from "./io.js";
import { renderDiagrams } from "./diagrams.js";
import type { AgentInput, AgentRole } from "./types.js";

const ROLE_LABEL: Record<AgentRole, string> = {
  questionAnalysis: "问题分析",
  contentOrganization: "内容组织",
  contentGeneration: "内容生成",
  contentReview: "内容审核",
  diagramSvg: "SVG作图",
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
  const noDiagram = process.env.NO_DIAGRAM === "1";

  // 按角色取配置调 runAgent(复用同一 streaming client)
  const runRole = (role: AgentRole, input: AgentInput) => {
    const cfg = resolveAgentConfig(config, role);
    console.error(`  → [${ROLE_LABEL[role]}] 运行中(model=${cfg.model}, effort=${cfg.effort})…`);
    return runAgent(input, cfg, client);
  };

  // 联网搜索:走网关 Tavily 透明代理;NO_SEARCH=1 或没配 BASE_URL 时跳过
  const base = process.env.ANTHROPIC_BASE_URL || "";
  const search =
    process.env.NO_SEARCH === "1" || !base
      ? undefined
      : async (query: string) => {
          console.error("  🔍 正在联网搜索…");
          const r = await tavilySearch(query, { base, apiKey: process.env.ANTHROPIC_API_KEY ?? "" });
          return formatSearchContext(r);
        };

  // GATE_AUTOPASS=1:两道门自动通过(无人值守/自动化验证);否则真人 readline 交互
  const asker =
    process.env.GATE_AUTOPASS === "1"
      ? Object.assign(async () => "", { close: () => {} })
      : createReadlineAsker();
  try {
    const result = await runPipeline(userInput, {
      loadPrompt,
      runRole,
      gate: asker,
      search,
      publish: async (markdown) => {
        // 把 markdown 里的【配图指令】渲染成飞书画板 SVG(失败的降级为文字占位)
        let md = markdown;
        if (!noDiagram) {
          console.error("\n正在生成配图(SVG)…");
          md = await renderDiagrams(markdown, { loadPrompt, runRole });
        }
        if (dryRun) {
          console.error("\n(dry-run)跳过飞书写入,打印将导入的内容:\n");
          console.log(md);
          return "(dry-run:未写入飞书)";
        }
        console.error("\n正在写入飞书…");
        return larkCreateDoc(md, "markdown");
      },
    });
    console.log("\n✅ 已写入飞书:", result.url);
  } finally {
    asker.close(); // 释放 stdin,让进程退出
  }
}

main().catch((err) => {
  console.error("❌ 失败:", err.message);
  process.exit(1);
});
