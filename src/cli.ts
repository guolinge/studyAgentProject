/**
 * cli.ts — 程序入口:装配所有依赖并启动流水线
 *
 * 职责:
 *   1. 读取环境变量(API Key、开关标志)
 *   2. 创建 Anthropic SDK 客户端(streaming 模式)
 *   3. 装配 runRole / search / dedup / publish 等依赖,注入 runPipeline
 *   4. 处理 publish 后的配图补齐(patchDiagrams)
 *   5. 处理蒸馏器流程(收集门反馈 → 展示变更 → 用户批准 → 写回文件 → git commit)
 *
 * 环境变量:
 *   ANTHROPIC_API_KEY     必填
 *   ANTHROPIC_BASE_URL    公司网关;不设则走官方 API(联网搜索/查重也会自动跳过)
 *   LARK_DRY_RUN=1        不写飞书,打印 Markdown
 *   NO_SEARCH=1           跳过联网搜索
 *   NO_DEDUP=1            跳过查重去重
 *   NO_DIAGRAM=1          跳过 SVG 配图
 *   NO_DISTILLER=1        跳过蒸馏器
 *   GATE_AUTOPASS=1       所有门自动通过(自动化测试用)
 *   DEDUP_CHOICE=N        配合 GATE_AUTOPASS,查重门自动选第 N 篇合并
 *   MODEL_OVERRIDE        覆盖所有 agent 的模型(测试省 token 用)
 *   EFFORT_OVERRIDE       覆盖所有 agent 的 effort
 *   INDEX_DOC_TOKEN       总索引文档 token;设置后每次 publish 自动追加一行
 */

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { loadConfig, resolveAgentConfig } from "./config.js";
import { loadPrompt } from "./prompts.js";
import { runAgent, type ModelClient } from "./agentRunner.js";
import {
  larkCreateDoc,
  larkCreateFolder,
  larkUpdateStrReplace,
  larkSearchDocs,
  larkFetchOutline,
  larkBlockInsertAfter,
  larkAppendToDoc,
  type SearchHit,
} from "./tools/lark.js";
import type { PlacementInfo } from "./orchestrator.js";
import { tavilySearch, formatSearchContext } from "./tools/tavily.js";
import { runPipeline } from "./orchestrator.js";
import { createReadlineAsker } from "./io.js";
import { renderDiagrams, patchDiagrams } from "./diagrams.js";
import { mergeIntoDoc } from "./merge.js";
import { runDistiller, applyChange, formatChangesForApproval } from "./distiller.js";
import type { AgentInput, AgentRole, ResolvedAgentConfig } from "./types.js";
import { execSync } from "node:child_process";

// 角色名 → 中文标签(仅用于 console.error 进度输出)
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
  // 从命令行参数拼出用户输入(允许带空格,不需要引号)
  const userInput = process.argv.slice(2).join(" ").trim();
  if (!userInput) {
    console.error('用法:npm start -- "你想搞懂的知识点,例如:pnpm 原理是什么"');
    process.exit(1);
  }

  const config = loadConfig();

  // 初始化 Anthropic SDK
  // baseURL 不设时走官方 API;设了走公司网关(同时支持 Anthropic 格式 + Tavily 代理)
  const sdk = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
  });

  // 统一用 streaming + finalMessage:
  //   maxTokens=32000 时官方 SDK 会拒绝非流式请求(有上限),streaming 无此限制
  const client: ModelClient = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createMessage: (params) => sdk.messages.stream(params as any).finalMessage() as never,
  };

  // 开关标志
  const dryRun = process.env.LARK_DRY_RUN === "1";
  const noDiagram = process.env.NO_DIAGRAM === "1";
  const noDistiller = process.env.NO_DISTILLER === "1";

  // 调试省 token:MODEL_OVERRIDE / EFFORT_OVERRIDE 覆盖所有 agent(不改正式 config)
  const modelOverride = process.env.MODEL_OVERRIDE;
  const effortOverride = process.env.EFFORT_OVERRIDE as ResolvedAgentConfig["effort"] | undefined;

  /**
   * runRole:按角色取配置,应用可能的覆盖,打印进度后调用 runAgent。
   * 所有 agent 都通过这个函数执行,方便统一切换 model/effort。
   */
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

  // 联网搜索:走网关 Tavily 透明代理
  // 没有配 BASE_URL 或设 NO_SEARCH=1 时跳过(search=undefined 则 orchestrator 不搜索)
  const base = process.env.ANTHROPIC_BASE_URL || "";
  const search =
    process.env.NO_SEARCH === "1" || !base
      ? undefined
      : async (query: string) => {
          console.error("  🔍 正在联网搜索…");
          const r = await tavilySearch(query, { base, apiKey: process.env.ANTHROPIC_API_KEY ?? "" });
          return formatSearchContext(r);
        };

  // 查重去重合并:搜本人相关旧文档;选合并则把增量插进旧文
  // 没有配 BASE_URL 或设 NO_DEDUP=1 时跳过(dedup=undefined 则 orchestrator 不查重)
  const dedup =
    process.env.NO_DEDUP === "1" || !base
      ? undefined
      : {
          // 搜索:--only-title --mine 锁定本人文档标题搜索
          search: (kw: string) => larkSearchDocs(kw, { mine: true, onlyTitle: true }),
          // 合并:读旧文大纲 → 增量生成 → 插锚点;合并后也补图
          merge: async (input: string, target: SearchHit) => {
            console.error(`  🔀 合并进旧文档《${target.title}》…`);
            const r = await mergeIntoDoc(input, target, {
              loadPrompt,
              runRole,
              fetchOutline: (u) => larkFetchOutline(u),
              insertAfter: (u, b, c) => larkBlockInsertAfter(u, b, c),
            });
            // 增量内容也可能含【配图指令】,同样异步补图
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

  // 门交互:GATE_AUTOPASS=1 时自动通过(适合自动化测试/CI)
  // 查重门特殊处理:返回 DEDUP_CHOICE 值(序号=合并,空=新建)
  const asker =
    process.env.GATE_AUTOPASS === "1"
      ? Object.assign(
          async (title: string) => (title.includes("查重") ? process.env.DEDUP_CHOICE ?? "" : ""),
          { close: () => {} },
        )
      : createReadlineAsker();

  // 总索引更新:publish 后自动追加一行 |标题|分类|链接|日期|
  // dryRun 或未配 INDEX_DOC_TOKEN 时跳过
  const indexDocToken = process.env.INDEX_DOC_TOKEN;
  const updateIndex =
    dryRun || !indexDocToken
      ? undefined
      : async (title: string, url: string) => {
          const date = new Date().toISOString().split("T")[0];
          const category = userInput.length > 20 ? userInput.slice(0, 20) + "…" : userInput;
          const row = `| ${title} | ${category} | [链接](${url}) | ${date} |\n`;
          console.error("  📑 正在更新总索引…");
          await larkAppendToDoc(indexDocToken, row);
        };

  try {
    const result = await runPipeline(userInput, {
      loadPrompt,
      runRole,
      gate: asker,
      search,
      dedup,
      updateIndex,
      /**
       * publish:流水线完成后把最终 Markdown 写入飞书。
       *
       * 渐进式策略:
       *   ① 先写文字(含【配图指令】占位符) → 立刻打印 URL(用户可马上阅读)
       *   ② 再并行生成配图,用 str_replace 把占位符替换成飞书画板(图陆续出现)
       *
       * dry-run 时:内联渲染所有图后打印 Markdown,不写飞书。
       */
      publish: async (markdown, placement: PlacementInfo) => {
        if (dryRun) {
          const md = noDiagram ? markdown : await renderDiagrams(markdown, { loadPrompt, runRole });
          console.error("\n(dry-run)跳过飞书写入,打印将导入的内容:\n");
          console.log(md);
          return "(dry-run:未写入飞书)";
        }
        // 解析目标文件夹 token（需要时先创建新文件夹）
        let folderToken: string;
        if (placement.type === "new") {
          console.error(`  📁 新建文件夹「${placement.folderName}」…`);
          folderToken = await larkCreateFolder(placement.folderName, placement.parentToken);
        } else {
          folderToken = placement.folderToken;
        }
        // ① 先写文字,用户可立刻开始阅读
        console.error("\n正在写入飞书(文字)…");
        const url = await larkCreateDoc(markdown, "markdown", folderToken);
        console.log("\n✅ 文字已写入飞书:", url);
        // ② 后台补图(并行生成 + 串行 update)
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

    // 拆分模式：逐篇跑完整流水线
    if (result.kind === "split") {
      console.error(`\n命题已拆分为 ${result.topics.length} 篇，逐篇生成：`);
      for (const topic of result.topics) {
        console.error(`\n▶ 开始生成：${topic.title}`);
        const fixedPlacement = topic.placement;
        const subResult = await runPipeline(topic.title, {
          loadPrompt,
          runRole,
          gate: asker,
          search,
          dedup,
          updateIndex,
          // 用拆分时确认的归档位置覆盖子流水线的 publish
          publish: async (markdown) => {
            let folderToken: string;
            if (fixedPlacement.type === "new") {
              console.error(`  📁 新建文件夹「${fixedPlacement.folderName}」…`);
              folderToken = await larkCreateFolder(fixedPlacement.folderName, fixedPlacement.parentToken);
            } else {
              folderToken = fixedPlacement.folderToken;
            }
            console.error("\n正在写入飞书(文字)…");
            const url = await larkCreateDoc(markdown, "markdown", folderToken);
            console.log(`\n✅ 「${topic.title}」已写入飞书:`, url);
            if (!noDiagram) {
              await patchDiagrams(markdown, url, {
                loadPrompt,
                runRole,
                updateDoc: (u, p, c) => larkUpdateStrReplace(u, p, c),
                onProgress: (m) => console.error(m),
              });
            }
            return url;
          },
        });
        if (subResult.kind === "single") {
          console.log(`✅ 「${topic.title}」:`, subResult.url);
        }
      }
      return;
    }

    console.log("\n✅ 已写入飞书:", result.url);

    // 蒸馏器:有门反馈时自动运行,让 prompt 越用越懂用户
    // result.feedbacks 只含非空反馈(用户给了修改意见的门),无反馈时跳过
    if (!noDistiller && result.kind === "single" && result.feedbacks.length > 0) {
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
        // 展示所有变更,等用户批准
        const display = formatChangesForApproval(changes);
        const reply = await asker("🧪 蒸馏结果 · 批准后写回 prompts/", display);

        if (reply.toLowerCase() === "n" || reply.toLowerCase() === "no") {
          console.error("  → 已跳过全部蒸馏变更。");
        } else {
          // import.meta.url 是当前文件(dist/src/cli.ts),上两层是项目根目录
          const projectRoot = new URL("..", import.meta.url).pathname;
          let applied = 0;
          for (const change of changes) {
            try {
              applyChange(change, projectRoot);
              // git add 单个文件,避免意外暂存其他改动
              execSync(`git add ${JSON.stringify(change.file)}`, { cwd: projectRoot });
              applied++;
              console.error(`  ✅ 已应用:${change.file}`);
            } catch (e) {
              console.error(`  ⚠ 应用失败(${change.file}):${(e as Error).message}`);
            }
          }
          if (applied > 0) {
            // commit message 列出改动的文件,方便 git log 追溯
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
    // 释放 stdin,让进程正常退出(不调用则 readline 持有 stdin 引用,进程挂起)
    asker.close();
  }
}

main().catch((err) => {
  console.error("❌ 失败:", err.message);
  process.exit(1);
});
