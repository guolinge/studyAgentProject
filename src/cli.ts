import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { loadConfig, resolveAgentConfig } from "./config.js";
import { loadPrompt } from "./prompts.js";
import { runAgent, type ModelClient } from "./agentRunner.js";
import {
  larkCreateDoc,
  larkUpdateStrReplace,
  larkSearchDocs,
  larkFetchOutline,
  larkBlockInsertAfter,
  type SearchHit,
} from "./tools/lark.js";
import { tavilySearch, formatSearchContext } from "./tools/tavily.js";
import { runPipeline } from "./orchestrator.js";
import { createReadlineAsker } from "./io.js";
import { renderDiagrams, patchDiagrams } from "./diagrams.js";
import { mergeIntoDoc } from "./merge.js";
import { runDistiller, applyChange, formatChangesForApproval } from "./distiller.js";
import type { AgentInput, AgentRole, ResolvedAgentConfig } from "./types.js";
import { execSync } from "node:child_process";

const ROLE_LABEL: Record<AgentRole, string> = {
  questionAnalysis: "问题分析",
  contentOrganization: "内容组织",
  contentGeneration: "内容生成",
  contentReview: "内容审核",
  diagramSvg: "SVG作图",
  incrementalMerge: "增量合并",
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
  const noDistiller = process.env.NO_DISTILLER === "1";

  // 测试省钱:MODEL_OVERRIDE / EFFORT_OVERRIDE 覆盖所有 agent 的模型/effort(不改正式 config)
  const modelOverride = process.env.MODEL_OVERRIDE;
  const effortOverride = process.env.EFFORT_OVERRIDE as ResolvedAgentConfig["effort"] | undefined;

  // 按角色取配置调 runAgent(复用同一 streaming client)
  const runRole = (role: AgentRole, input: AgentInput) => {
    const base = resolveAgentConfig(config, role);
    const cfg: ResolvedAgentConfig = {
      ...base,
      model: modelOverride || base.model,
      effort: effortOverride || base.effort,
    };
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

  // 查重去重合并:搜本人相关旧文档;选合并则把增量插进旧文。NO_DEDUP=1 或没配网关时跳过
  const dedup =
    process.env.NO_DEDUP === "1" || !base
      ? undefined
      : {
          search: (kw: string) => larkSearchDocs(kw, { mine: true, onlyTitle: true }),
          merge: async (input: string, target: SearchHit) => {
            console.error(`  🔀 合并进旧文档《${target.title}》…`);
            const r = await mergeIntoDoc(input, target, {
              loadPrompt,
              runRole,
              fetchOutline: (u) => larkFetchOutline(u),
              insertAfter: (u, b, c) => larkBlockInsertAfter(u, b, c),
            });
            // 增量里的【配图指令】也补图(在旧文档上 str_replace 占位→画板)
            if (!noDiagram) {
              await patchDiagrams(r.incrementalMarkdown, r.url, {
                loadPrompt,
                runRole,
                updateDoc: (u, p, c) => larkUpdateStrReplace(u, p, c),
                onProgress: (m) => console.error(m),
              });
            }
            return { url: r.url, incrementalMarkdown: r.incrementalMarkdown };
          },
        };

  // GATE_AUTOPASS=1:门自动通过(无人值守/自动化验证);查重门返回 DEDUP_CHOICE(默认""=新建,设序号=合并该篇)
  const asker =
    process.env.GATE_AUTOPASS === "1"
      ? Object.assign(
          async (title: string) => (title.includes("查重") ? process.env.DEDUP_CHOICE ?? "" : ""),
          { close: () => {} },
        )
      : createReadlineAsker();
  try {
    const result = await runPipeline(userInput, {
      loadPrompt,
      runRole,
      gate: asker,
      search,
      dedup,
      publish: async (markdown) => {
        if (dryRun) {
          // dry-run 用于调试:内联渲染所有图后打印(不写飞书)
          const md = noDiagram ? markdown : await renderDiagrams(markdown, { loadPrompt, runRole });
          console.error("\n(dry-run)跳过飞书写入,打印将导入的内容:\n");
          console.log(md);
          return "(dry-run:未写入飞书)";
        }
        // ① 先写文字(含配图占位),立刻拿到 URL —— 你可马上阅读
        console.error("\n正在写入飞书(文字)…");
        const url = await larkCreateDoc(markdown, "markdown");
        console.log("\n✅ 文字已写入飞书:", url);
        // ② 再逐张画图,用 str_replace 把占位补成画板(在飞书里图会陆续出现)
        if (!noDiagram) {
          console.error("\n开始补图(可先阅读文字,图会陆续补上)…");
          const { total, patched } = await patchDiagrams(markdown, url, {
            loadPrompt,
            runRole,
            updateDoc: (u, p, c) => larkUpdateStrReplace(u, p, c),
            onProgress: (m) => console.error(m),
          });
          console.error(`✅ 配图补齐:${patched}/${total}`);
        }
        return url;
      },
    });
    console.log("\n✅ 已写入飞书:", result.url);

    // 蒸馏:有门反馈时自动运行,让 prompt 越用越懂用户
    if (!noDistiller && result.feedbacks.length > 0) {
      console.error(`\n🧪 发现 ${result.feedbacks.length} 条门反馈,正在运行蒸馏器…`);
      let changes: import("./distiller.js").ProposedChange[];
      try {
        changes = await runDistiller(result.feedbacks, { loadPrompt, runRole });
      } catch (e) {
        console.error(`  ⚠ 蒸馏器运行失败,跳过:${(e as Error).message}`);
        changes = [];
      }
      if (changes.length === 0) {
        console.error("  → 无规律性改动建议,跳过。");
      } else {
        const display = formatChangesForApproval(changes);
        const reply = await asker("🧪 蒸馏结果 · 批准后写回 prompts/", display);
        if (reply.toLowerCase() === "n" || reply.toLowerCase() === "no") {
          console.error("  → 已跳过全部蒸馏变更。");
        } else {
          const projectRoot = new URL("..", import.meta.url).pathname;
          let applied = 0;
          for (const change of changes) {
            try {
              applyChange(change, projectRoot);
              execSync(`git add ${JSON.stringify(change.file)}`, { cwd: projectRoot });
              applied++;
              console.error(`  ✅ 已应用:${change.file}`);
            } catch (e) {
              console.error(`  ⚠ 应用失败(${change.file}):${(e as Error).message}`);
            }
          }
          if (applied > 0) {
            const summary = changes.map((c) => c.file.replace("prompts/", "").replace(".md", "")).join(", ");
            execSync(
              `git commit -m "chore(distiller): 蒸馏规则 [${summary}]"`,
              { cwd: projectRoot },
            );
            console.error(`  🎉 规则已提交:chore(distiller): 蒸馏规则 [${summary}]`);
          }
        }
      }
    }
  } finally {
    asker.close(); // 释放 stdin,让进程退出
  }
}

main().catch((err) => {
  console.error("❌ 失败:", err.message);
  process.exit(1);
});
