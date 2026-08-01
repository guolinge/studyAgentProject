/**
 * distiller.ts — 门反馈蒸馏:把用户修改意见提炼成 prompt 规则
 *
 * 工作原理:
 *   1. orchestrator 在流水线运行中收集门1/门2的非空用户反馈
 *   2. runDistiller() 把反馈 + 当前 prompt 文件内容喂给蒸馏器 agent
 *   3. agent 提炼出规律性偏好,输出 ProposedChange 列表(自定义格式)
 *   4. cli.ts 展示变更,用户批准后 applyChange() 写回文件,git commit
 *
 * 设计原则:
 *   - 只改规律性偏好(多次出现的模式),一次性临时要求不写进 prompt
 *   - 改动最小化:一句话能解决的不改整段
 *   - 人工批准后才写回(不自动修改 prompt)
 *   - 每次变更 git commit,可回溯可回滚
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { GateFeedback, AgentInput, AgentRole } from "./types.js";

/**
 * 蒸馏器提出的一条 prompt 文件变更。
 * oldText 为空表示追加到文件末尾(新增规则);非空表示精确替换。
 */
export interface ProposedChange {
  file: string;     // 相对项目根的路径,如 "prompts/style-rules.md"
  reason: string;   // 一句话说明:这条反馈反映了什么规律性偏好
  oldText: string;  // 被替换的原文;空字符串表示追加到文件末尾
  newText: string;  // 替换后的新文(或追加内容)
}

/**
 * 解析蒸馏器 agent 的输出,提取所有 ProposedChange。
 *
 * 输出格式(来自 prompts/distiller.md):
 *   <<<BEGIN_CHANGE>>>
 *   FILE: prompts/style-rules.md
 *   REASON: 用户在门2多次要求必须包含时间复杂度分析
 *   OLD:
 *   旧文内容(可空,空=追加)
 *   NEW:
 *   新文内容
 *   <<<END_CHANGE>>>
 *
 *   <<<NO_CHANGES>>>  ← 若无规律性反馈则输出这个
 *
 * 解析失败的 block 静默跳过(不抛错),确保部分有效变更仍能应用。
 */
export function parseDistillerOutput(text: string): ProposedChange[] {
  // 无改动的哨兵
  if (/<<<NO_CHANGES>>>/.test(text)) return [];

  const changes: ProposedChange[] = [];
  // 用非贪婪匹配提取每个 block 的内容
  const blockRegex = /<<<BEGIN_CHANGE>>>([\s\S]*?)<<<END_CHANGE>>>/g;

  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(text)) !== null) {
    const block = match[1];

    // 提取单行字段 FILE / REASON
    const fileMatch = block.match(/^FILE:\s*(.+)$/m);
    const reasonMatch = block.match(/^REASON:\s*(.+)$/m);
    // OLD 段:从 "OLD:\n" 到 "NEW:" 之间的内容(可能跨多行)
    const oldMatch = block.match(/^OLD:\n([\s\S]*?)^NEW:/m);
    // NEW 段:从 "NEW:\n" 到 block 末尾
    const newMatch = block.match(/^NEW:\n([\s\S]*)$/m);

    // 缺少必要字段时跳过这个 block
    if (!fileMatch || !reasonMatch || !newMatch) continue;

    changes.push({
      file: fileMatch[1].trim(),
      reason: reasonMatch[1].trim(),
      oldText: (oldMatch ? oldMatch[1] : "").trim(), // OLD 可为空(追加)
      newText: newMatch[1].trim(),
    });
  }
  return changes;
}

/**
 * 把 ProposedChange 应用到文件。
 *
 * - oldText 非空:精确字符串替换(找不到则抛错,让调用方决定是否跳过)
 * - oldText 为空:追加到文件末尾,加一个空行分隔
 *
 * @param rootDir  项目根目录(change.file 是相对这个目录的路径)
 * @throws         当 oldText 非空但在文件中找不到时抛错
 */
export function applyChange(change: ProposedChange, rootDir: string): void {
  const filePath = path.join(rootDir, change.file);
  const content = fs.readFileSync(filePath, "utf8");

  if (change.oldText === "") {
    // 追加模式:确保与现有内容之间有一个空行
    const sep = content.endsWith("\n") ? "\n" : "\n\n";
    fs.writeFileSync(filePath, `${content}${sep}${change.newText}\n`, "utf8");
  } else {
    if (!content.includes(change.oldText)) {
      throw new Error(`找不到要替换的原文:「${change.oldText.slice(0, 40)}…」in ${change.file}`);
    }
    // 只替换第一次出现的位置(String.replace 默认只替换第一个)
    fs.writeFileSync(filePath, content.replace(change.oldText, change.newText), "utf8");
  }
}

/**
 * 把多条变更格式化成人类可读的审批文本,供 cli.ts 展示给用户。
 *
 * 示例输出:
 *   [1/2] 文件: prompts/style-rules.md
 *   理由: 用户反馈代码注释不够详细
 *   旧文:
 *   代码需要注释
 *   新文:
 *   代码必须包含行内注释...
 *
 *   ──────────────
 *
 *   [2/2] 文件: prompts/content-organization.md
 *   ...
 */
export function formatChangesForApproval(changes: ProposedChange[]): string {
  return changes
    .map((c, i) => {
      const header = changes.length > 1 ? `[${i + 1}/${changes.length}] ` : "";
      // oldText 为空说明是追加操作,展示"追加到文件末尾"而不是空的旧文区
      const oldSection = c.oldText === "" ? "追加到文件末尾" : `旧文:\n${c.oldText}`;
      return `${header}文件: ${c.file}\n理由: ${c.reason}\n${oldSection}\n新文:\n${c.newText}`;
    })
    .join("\n\n──────────────\n\n");
}

export interface DistillerDeps {
  loadPrompt: (name: string) => string;
  runRole: (role: AgentRole, input: AgentInput) => Promise<string>;
}

/**
 * 运行蒸馏器 agent:把门反馈 + 当前 prompt 内容喂进去,返回变更列表。
 *
 * 只传最可能被改动的 prompt 文件(style-rules + 各角色的骨干 prompt),
 * 不传全部文件,节省 token(蒸馏器用 Haiku,本来就轻量)。
 *
 * agent 输出为空或无规律性反馈时,返回空数组。
 */
export async function runDistiller(
  feedbacks: GateFeedback[],
  deps: DistillerDeps,
): Promise<ProposedChange[]> {
  // 格式化反馈记录:每条一行"门名: 反馈内容"
  const feedbackText = feedbacks
    .map((f) => `${f.gate}: "${f.feedback}"`)
    .join("\n");

  // 载入最相关的 prompt 文件供 agent 参考和改动
  const promptFiles = [
    "style-rules",
    "question-analysis",
    "content-organization",
    "content-generation",
  ];
  const promptContents = promptFiles
    .map((name) => `【当前 prompts/${name}.md】\n${deps.loadPrompt(name)}`)
    .join("\n\n");

  const system = deps.loadPrompt("distiller");
  const user = `【本次门反馈】\n${feedbackText}\n\n${promptContents}`;

  const output = await deps.runRole("distiller", { system, user });
  return parseDistillerOutput(output);
}
