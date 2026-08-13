/**
 * orchestrator.ts — 流水线编排核心
 *
 * 完整流程:
 *   问题分析 →门1→ [查重分流] → 联网搜索 → 内容组织 →门2→ 内容生成 →审核→ publish
 *
 * 查重分流(有 dedup 依赖时):
 *   - 提取查重关键词 → 搜索相关旧文档
 *   - 有候选 → 弹查重门 → 选合并 → mergeIntoDoc → 提前返回(不走新建流程)
 *   - 选新建 / 无候选 → 继续正常流程
 *
 * 门机制(iterateWithGate):
 *   - 用户回车 = 通过,返回当前产出
 *   - 用户输入意见 = 把意见拼进 user prompt 重跑,循环直到通过
 *   - 每次非空反馈通过 collector 回调收集,最终在 PipelineResult.feedbacks 里返回
 *
 * 所有依赖通过 PipelineDeps 注入,单测时可替换所有副作用。
 */

import type { AgentInput, AgentRole, GateFeedback } from "./types.js";
import type { Asker } from "./io.js";
import type { SearchHit } from "./tools/lark.js";
import { parseDedupKeywords, searchDuplicates, formatDedupPrompt, parseGateChoice } from "./dedup.js";
import { renderFolderTree, findByToken, folderTreeRoot } from "./folderTree.js";
import { buildOutlineBundle, type ResearchMode } from "./outlineBundle.js";

/** 门2「复制大纲」哨兵：gate 返回此值表示走 offload 分支 */
export const COPY_OUTLINE_SIGNAL = "__COPY_OUTLINE__";

/** 归档位置：现有文件夹 or 需要新建的文件夹 */
export type PlacementInfo =
  | { type: "existing"; folderToken: string; title: string }
  | { type: "new"; parentToken: string; folderName: string; title: string };

/**
 * 从 questionAnalysis 输出中解析 ## 文档标题 和 ## 归档位置。
 *
 * 现有文件夹格式：`<路径> [token: <token>]`
 * 新建文件夹格式：`新建文件夹：<父路径>/<新名> [parent_token: <token>]`
 *
 * token 合法性用 findByToken 验证；无法识别时 fallback 到技术知识库根节点。
 */
export function parsePlacement(output: string, userInputFallback: string): PlacementInfo {
  const titleMatch = output.match(/^##\s*文档标题\s*\n([^\n#]+)/m);
  const title = titleMatch ? titleMatch[1].trim() : userInputFallback;

  const locMatch = output.match(/^##\s*归档位置\s*\n([^\n#]+)/m);
  const locLine = locMatch ? locMatch[1].trim() : "";

  // 新建文件夹
  const newMatch = locLine.match(/新建文件夹[：:].+?\[parent_token:\s*([A-Za-z0-9]+)\]/);
  if (newMatch) {
    const parentToken = newMatch[1];
    const folderNameMatch = locLine.match(/\/([^/\[]+)\s*\[/);
    const folderName = folderNameMatch ? folderNameMatch[1].trim() : "新建分类";
    const validParent = findByToken(parentToken) ? parentToken : folderTreeRoot.token;
    return { type: "new", parentToken: validParent, folderName, title };
  }

  // 现有文件夹
  const tokenMatch = locLine.match(/\[token:\s*([A-Za-z0-9]+)\]/);
  if (tokenMatch) {
    const token = tokenMatch[1];
    if (findByToken(token)) return { type: "existing", folderToken: token, title };
  }

  // fallback：技术知识库根
  return { type: "existing", folderToken: folderTreeRoot.token, title };
}

/**
 * 从 questionAnalysis 输出中解析 ## 拆分建议。
 *
 * 格式：`- 文档 A「标题」→ 归档：路径 [token: xxx]`
 * 解析为 SplitDoc[]；没有该 section 时返回 null。
 */
export function parseSplitSuggestion(output: string): SplitDoc[] | null {
  const sectionMatch = output.match(/^##\s*拆分建议[^\n]*\n([\s\S]*?)(?=^##|\Z)/m);
  if (!sectionMatch) return null;

  const lines = sectionMatch[1].split("\n").filter((l) => l.trim().startsWith("-"));
  if (lines.length < 2) return null; // 少于 2 篇不算有效拆分

  const docs: SplitDoc[] = [];
  for (const line of lines) {
    const titleMatch = line.match(/「([^」]+)」/);
    const title = titleMatch ? titleMatch[1].trim() : "";
    if (!title) continue;

    // 提取 token（现有文件夹）或 parent_token（新建文件夹）
    const tokenMatch = line.match(/\[token:\s*([A-Za-z0-9]+)\]/);
    const parentMatch = line.match(/\[parent_token:\s*([A-Za-z0-9]+)\]/);
    let placement: PlacementInfo;

    if (parentMatch) {
      const parentToken = findByToken(parentMatch[1]) ? parentMatch[1] : folderTreeRoot.token;
      const folderMatch = line.match(/\/([^/\[→]+)\s*\[parent_token/);
      const folderName = folderMatch ? folderMatch[1].trim() : "新建分类";
      placement = { type: "new", parentToken, folderName, title };
    } else if (tokenMatch && findByToken(tokenMatch[1])) {
      placement = { type: "existing", folderToken: tokenMatch[1], title };
    } else {
      placement = { type: "existing", folderToken: folderTreeRoot.token, title };
    }
    docs.push({ title, placement });
  }
  return docs.length >= 2 ? docs : null;
}

/** 从生成的 Markdown 里取首个 # 标题作为文档标题(取不到就用输入回退) */
export function extractTitle(markdown: string, fallback: string): string {
  const m = markdown.match(/^#\s+(.+)$/m);
  return (m?.[1] ?? fallback).trim();
}

interface OperationType {
  mode: "create" | "patch_diagrams";
  docUrl?: string;
}

/** 解析 question-analysis 输出中的 `## 操作类型` section，默认 create */
export function parseOperationType(outline: string): OperationType {
  const match = outline.match(/##\s*操作类型[^\n]*\n([\s\S]*?)(?=\n##|$)/);
  if (!match) return { mode: "create" };
  const block = match[1].trim();
  if (/^patch_diagrams/i.test(block)) {
    const urlMatch = block.match(/https?:\/\/[^\s)）,，。\]]+/);
    return { mode: "patch_diagrams", docUrl: urlMatch?.[0] };
  }
  return { mode: "create" };
}

export interface PipelineDeps {
  loadPrompt: (name: string) => string;
  runRole: (role: AgentRole, input: AgentInput) => Promise<string>;
  gate: Asker;              // 门1/门2/查重门共用同一个 Asker 实例
  publish: (markdown: string, placement: PlacementInfo) => Promise<string>; // 写飞书,返回文档 URL
  reviewMaxRetries?: number; // 审核打回上限,默认 2
  researchEnabled?: boolean; // 开启联网研究步骤(searchResearch)
  dedup?: {
    search: (keyword: string) => Promise<SearchHit[]>; // 查重搜索
    merge: (userInput: string, target: SearchHit) => Promise<{ url: string; incrementalMarkdown: string }>;
  };
  updateIndex?: (title: string, url: string) => Promise<void>; // 每次 publish 后追加总索引一行
  /** 门2「复制大纲」分支：建仅含标题的空白文档，返回 URL */
  publishBlank?: (title: string, placement: PlacementInfo) => Promise<string>;
  onReviewFeedback?: (feedback: string) => void; // 内容审核 FAIL 时推送反馈内容（问题6）
  /** 在现有飞书文档上补画 SVG 配图（由 question-analysis 的 patch_diagrams 操作类型触发）*/
  patchDocDiagrams?: (docUrl: string) => Promise<{ url: string; patched: number; total: number }>;
  /** 门2「复制大纲」bundle 的联网研究档位（full/digest/none），默认 digest */
  bundleResearchMode?: ResearchMode;
  /** 软错误上报：降级不阻塞时通知前端（可选） */
  onSoftError?: (step: PipelineStep, label: string, message: string) => void;
}

/** 流水线环节标识，用于 artifacts 索引和重试定位 */
export type PipelineStep =
  | "questionAnalysis" | "patch_diagrams" | "split" | "dedup" | "research"
  | "organization" | "generation" | "review" | "publish" | "updateIndex";

/** 中间产物寄存器：每个环节成功后把产出写进来，供重试时复用 */
export interface StepArtifacts {
  outline1?: string;
  placement?: PlacementInfo;
  opType?: OperationType;
  splitDocs?: SplitDoc[] | null;
  dedupChoice?: { action: "merge" | "new"; target?: SearchHit };
  researchMemo?: string;
  skeleton?: string;
  markdown?: string;
  url?: string;
}

/** 环节失败时抛出，外层据此判断是否走 paused 而非全局 error */
export class PipelineAbortError extends Error {
  constructor(public step: PipelineStep, message: string) {
    super(message);
    this.name = "PipelineAbortError";
  }
}

/** 拆分模式下的单篇子文档描述 */
export interface SplitDoc {
  title: string;
  placement: PlacementInfo;
}

export type PipelineResult =
  | { kind: "single"; url: string; markdown: string; skeleton: string; feedbacks: GateFeedback[] }
  | { kind: "split"; topics: SplitDoc[] }
  | { kind: "outline_copied"; url: string; bundle: string; feedbacks: GateFeedback[] };

/**
 * 拼 system prompt:角色文件(+ 可选附上 style-rules)。
 * 内容组织/内容生成需要 style-rules 约束写作风格;问题分析/审核不需要。
 */
function buildSystem(loadPrompt: PipelineDeps["loadPrompt"], roleFile: string, withRules: boolean): string {
  const role = loadPrompt(roleFile);
  if (!withRules) return role;
  return `${role}\n\n---\n\n${loadPrompt("style-rules")}`;
}

/**
 * 门迭代:跑 role → 展示 → 收反馈。
 *
 * 循环逻辑:
 *   - gate 返回 "" → 通过,返回当前产出
 *   - gate 返回非空 → 把反馈拼进 user,记录到 collector,重跑 role
 *
 * baseUser 不变(保留原始任务上下文);每次迭代新 user 追加上一版产出 + 修改意见,
 * 让 agent 在看到完整历史的基础上修改。
 *
 * collector 可选,用于 Distiller:把每次非空反馈记录到 feedbacks 数组。
 */
async function iterateWithGate(
  deps: PipelineDeps,
  role: AgentRole,
  gateTitle: string,
  system: string,
  baseUser: string,
  collector?: (f: GateFeedback) => void,
): Promise<string> {
  let output = await deps.runRole(role, { system, user: baseUser });
  for (;;) {
    const reply = await deps.gate(gateTitle, output);
    if (reply === "") return output; // 通过
    collector?.({ gate: gateTitle, feedback: reply }); // 记录非空反馈
    const user = `${baseUser}\n\n【上一版产出】\n${output}\n\n【使用者修改意见】\n${reply}\n\n请据此修改后重新输出(保持同样的格式)。`;
    output = await deps.runRole(role, { system, user });
  }
}

/**
 * 完整流水线（入口，等价于 fromStep=undefined 的 runPipelineFrom）。
 *
 * 内容审核打回机制:
 *   contentReview agent 输出 "PASS" 则继续;输出 "FAIL ..." 则把问题拼进 user 重跑
 *   contentGeneration,最多 maxRetries 次。超出上限直接 publish(避免无限循环)。
 */
export async function runPipeline(userInput: string, deps: PipelineDeps): Promise<PipelineResult> {
  return runPipelineFrom(userInput, deps, {});
}

/** step 执行顺序，fromStep 之前的跳过（artifacts 已有） */
const STEP_ORDER: PipelineStep[] = [
  "questionAnalysis", "patch_diagrams", "split", "dedup", "research",
  "organization", "generation", "review", "publish", "updateIndex",
];

/**
 * 可断点续跑的流水线。
 *
 * artifacts 持有已成功环节的产出，fromStep 指定从哪个环节开始（之前的跳过）。
 * 每个环节失败抛 PipelineAbortError，软失败（降级）调 onSoftError 不抛。
 * 分支返回（patch_diagrams / split / dedup merge / 复制大纲）通过 throw 一个
 * 内部 sentinel 结果对象实现提前退出——见 StepExitSignal。
 */
export async function runPipelineFrom(
  userInput: string,
  deps: PipelineDeps,
  artifacts: StepArtifacts,
  fromStep?: PipelineStep,
): Promise<PipelineResult> {
  const maxRetries = deps.reviewMaxRetries ?? 2;
  const feedbacks: GateFeedback[] = [];
  const collect = (f: GateFeedback) => feedbacks.push(f);
  const soft = (step: PipelineStep, label: string, message: string) =>
    deps.onSoftError?.(step, label, message);

  // fromStep 之前的环节跳过；fromStep 本身要执行
  const startIdx = fromStep ? STEP_ORDER.indexOf(fromStep) : 0;

  // 跑 step，失败抛 PipelineAbortError，分支返回抛 StepExitSignal
  const runStep = async (step: PipelineStep): Promise<void> => {
    try {
      const patch = await STEPS[step]();
      if (patch) Object.assign(artifacts, patch);
    } catch (e) {
      if (e instanceof StepExitSignal) throw e;
      throw new PipelineAbortError(step, (e as Error).message);
    }
  };

  // 各 step 定义为闭包，共享 artifacts / feedbacks / collect / soft
  const STEPS: Record<PipelineStep, () => Promise<Partial<StepArtifacts> | void>> = {
    async questionAnalysis() {
      const qaSystem = buildSystem(deps.loadPrompt, "question-analysis", false)
        .replace("{{FOLDER_TREE}}", renderFolderTree());
      const outline1 = await iterateWithGate(
        deps, "questionAnalysis", "门1 · 确认范围/意图", qaSystem, userInput, collect,
      );
      return { outline1, opType: parseOperationType(outline1), placement: parsePlacement(outline1, userInput), splitDocs: parseSplitSuggestion(outline1) };
    },

    async patch_diagrams() {
      const { opType } = artifacts;
      if (opType?.mode === "patch_diagrams" && opType.docUrl && deps.patchDocDiagrams) {
        const { url } = await deps.patchDocDiagrams(opType.docUrl);
        throw new StepExitSignal({ kind: "single", url, markdown: "", skeleton: "", feedbacks });
      }
    },

    async split() {
      const { splitDocs } = artifacts;
      if (!splitDocs) return;
      const splitPrompt =
        `检测到命题偏大，建议拆成 ${splitDocs.length} 篇：\n` +
        splitDocs.map((d, i) => `  ${i + 1}. 「${d.title}」`).join("\n") +
        "\n\n回车确认拆分 / 输入 n 不拆继续 / 输入修改意见重新分析";
      const reply = await deps.gate("拆分建议", splitPrompt);
      if (reply === "") throw new StepExitSignal({ kind: "split", topics: splitDocs });
      // reply === "n" 或有修改意见时：继续当前流程
    },

    async dedup() {
      if (!deps.dedup || !artifacts.outline1) return;
      const keywords = parseDedupKeywords(artifacts.outline1);
      const candidates = keywords.length
        ? await searchDuplicates(keywords, { search: deps.dedup.search })
        : [];
      if (candidates.length === 0) return;
      const reply = await deps.gate("查重 · 发现相关旧文档", formatDedupPrompt(candidates));
      const choice = parseGateChoice(reply, candidates);
      if (choice.action !== "merge") return;
      try {
        const { url, incrementalMarkdown } = await deps.dedup.merge(userInput, choice.target);
        throw new StepExitSignal({ kind: "single", url, markdown: incrementalMarkdown, skeleton: "", feedbacks });
      } catch (e) {
        if (e instanceof StepExitSignal) throw e;
        soft("dedup", "查重合并", (e as Error).message);
        // 降级继续新建流程
      }
    },

    async research() {
      if (!deps.researchEnabled) return;
      const researchSystem = buildSystem(deps.loadPrompt, "search-research", false);
      const researchUser = `${userInput}\n\n【已确认的意图与一级话题】\n${artifacts.outline1 ?? ""}`;
      try {
        const researchMemo = await deps.runRole("searchResearch", { system: researchSystem, user: researchUser });
        return { researchMemo };
      } catch (e) {
        soft("research", "联网研究", (e as Error).message);
        return { researchMemo: "" };
      }
    },

    async organization() {
      if (!artifacts.outline1) throw new Error("缺少 outline1，无法组织内容");
      const researchMemo = artifacts.researchMemo ?? "";
      const withSearch = (base: string) => (researchMemo ? `${base}\n\n${researchMemo}` : base);
      const orgSystem = buildSystem(deps.loadPrompt, "content-organization", true);
      const orgUser = withSearch(`${userInput}\n\n【已确认的范围与意图】\n${artifacts.outline1}`);
      let skeleton = await deps.runRole("contentOrganization", { system: orgSystem, user: orgUser });
      for (;;) {
        const bundle = buildOutlineBundle({
          question: userInput,
          research: researchMemo,
          skeleton,
          generation: deps.loadPrompt("content-generation"),
          styleRules: deps.loadPrompt("style-rules"),
          drawingRules: deps.loadPrompt("drawing-rules-ascii"),
        }, deps.bundleResearchMode ?? "digest");
        const reply = await deps.gate("门2 · 确认骨架", skeleton, bundle);
        if (reply === "") break;
        if (reply === COPY_OUTLINE_SIGNAL || reply === "copy" || reply === "复制大纲") {
          if (!deps.publishBlank) throw new Error("publishBlank 未注入，无法执行复制大纲分支");
          const placement = artifacts.placement!;
          const url = await deps.publishBlank(placement.title, placement);
          if (deps.updateIndex) {
            try { await deps.updateIndex(placement.title, url); }
            catch (e) { soft("updateIndex", "索引追加", (e as Error).message); }
          }
          throw new StepExitSignal({ kind: "outline_copied", url, bundle, feedbacks });
        }
        collect({ gate: "门2 · 确认骨架", feedback: reply });
        const user = `${orgUser}\n\n【上一版产出】\n${skeleton}\n\n【使用者修改意见】\n${reply}\n\n请据此修改后重新输出(保持同样的格式)。`;
        skeleton = await deps.runRole("contentOrganization", { system: orgSystem, user });
      }
      return { skeleton };
    },

    async generation() {
      if (!artifacts.skeleton) throw new Error("缺少 skeleton，无法生成内容");
      const researchMemo = artifacts.researchMemo ?? "";
      const withSearch = (base: string) => (researchMemo ? `${base}\n\n${researchMemo}` : base);
      const genSystem = buildSystem(deps.loadPrompt, "content-generation", true);
      const genUser = withSearch(`${userInput}\n\n【已确认的骨架】\n${artifacts.skeleton}`);
      const markdown = await deps.runRole("contentGeneration", { system: genSystem, user: genUser });
      return { markdown };
    },

    async review() {
      if (!artifacts.markdown || !artifacts.skeleton) throw new Error("缺少 markdown/skeleton，无法审核");
      const reviewSystem = buildSystem(deps.loadPrompt, "content-review", false);
      const genSystem = buildSystem(deps.loadPrompt, "content-generation", true);
      const researchMemo = artifacts.researchMemo ?? "";
      const withSearch = (base: string) => (researchMemo ? `${base}\n\n${researchMemo}` : base);
      const genUser = withSearch(`${userInput}\n\n【已确认的骨架】\n${artifacts.skeleton}`);
      let markdown = artifacts.markdown;
      for (let i = 0; i < maxRetries; i++) {
        const verdict = await deps.runRole("contentReview", {
          system: reviewSystem,
          user: `【骨架】\n${artifacts.skeleton}\n\n【正文】\n${markdown}`,
        });
        if (/^\s*PASS/.test(verdict)) break;
        deps.onReviewFeedback?.(verdict);
        markdown = await deps.runRole("contentGeneration", {
          system: genSystem,
          user: `${genUser}\n\n【上一版正文】\n${markdown}\n\n【审核问题】\n${verdict}\n\n请修补后重新输出完整正文。`,
        });
      }
      return { markdown };
    },

    async publish() {
      if (!artifacts.markdown || !artifacts.placement) throw new Error("缺少 markdown/placement，无法发布");
      const url = await deps.publish(artifacts.markdown, artifacts.placement);
      return { url };
    },

    async updateIndex() {
      if (!deps.updateIndex || !artifacts.url || !artifacts.markdown) return;
      const title = extractTitle(artifacts.markdown, userInput);
      try { await deps.updateIndex(title, artifacts.url); }
      catch (e) { soft("updateIndex", "索引追加", (e as Error).message); }
    },
  };

  for (let i = startIdx; i < STEP_ORDER.length; i++) {
    try {
      await runStep(STEP_ORDER[i]);
    } catch (e) {
      if (e instanceof StepExitSignal) return e.result;
      throw e;
    }
  }

  return {
    kind: "single",
    url: artifacts.url!,
    markdown: artifacts.markdown ?? "",
    skeleton: artifacts.skeleton ?? "",
    feedbacks,
  };
}

/** 内部 sentinel：step 想提前返回 PipelineResult 时抛这个，runPipelineFrom 捕获后直接返回 */
class StepExitSignal extends Error {
  constructor(public result: PipelineResult) {
    super("StepExitSignal");
    this.name = "StepExitSignal";
  }
}
