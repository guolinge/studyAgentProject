import * as fs from "node:fs";
import * as path from "node:path";
import type { GateFeedback, AgentInput, AgentRole } from "./types.js";

export interface ProposedChange {
  file: string;     // 相对项目根目录,如 "prompts/style-rules.md"
  reason: string;   // 一句话说明改动依据
  oldText: string;  // 被替换的原文;为空则追加到文件末尾
  newText: string;  // 替换后的新文(或追加内容)
}

/**
 * 解析蒸馏器输出的 <<<BEGIN_CHANGE>>> 格式。
 * 遇到 <<<NO_CHANGES>>> 返回空数组;格式错误的 block 静默跳过。
 */
export function parseDistillerOutput(text: string): ProposedChange[] {
  if (/<<<NO_CHANGES>>>/.test(text)) return [];

  const changes: ProposedChange[] = [];
  const blockRegex = /<<<BEGIN_CHANGE>>>([\s\S]*?)<<<END_CHANGE>>>/g;

  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(text)) !== null) {
    const block = match[1];

    const fileMatch = block.match(/^FILE:\s*(.+)$/m);
    const reasonMatch = block.match(/^REASON:\s*(.+)$/m);
    // OLD 和 NEW 之间可能跨多行;NEW 到块末
    const oldMatch = block.match(/^OLD:\n([\s\S]*?)^NEW:/m);
    const newMatch = block.match(/^NEW:\n([\s\S]*)$/m);

    if (!fileMatch || !reasonMatch || !newMatch) continue;

    changes.push({
      file: fileMatch[1].trim(),
      reason: reasonMatch[1].trim(),
      oldText: (oldMatch ? oldMatch[1] : "").trim(),
      newText: newMatch[1].trim(),
    });
  }
  return changes;
}

/**
 * 把 ProposedChange 应用到文件:
 * - oldText 非空 → 精确字符串替换(找不到则抛错)
 * - oldText 为空 → 追加到文件末尾(加空行分隔)
 */
export function applyChange(change: ProposedChange, rootDir: string): void {
  const filePath = path.join(rootDir, change.file);
  const content = fs.readFileSync(filePath, "utf8");

  if (change.oldText === "") {
    const sep = content.endsWith("\n") ? "\n" : "\n\n";
    fs.writeFileSync(filePath, `${content}${sep}${change.newText}\n`, "utf8");
  } else {
    if (!content.includes(change.oldText)) {
      throw new Error(`找不到要替换的原文:「${change.oldText.slice(0, 40)}…」in ${change.file}`);
    }
    fs.writeFileSync(filePath, content.replace(change.oldText, change.newText), "utf8");
  }
}

/** 把多条变更格式化为供用户阅读/批准的文本 */
export function formatChangesForApproval(changes: ProposedChange[]): string {
  return changes
    .map((c, i) => {
      const header = changes.length > 1 ? `[${i + 1}/${changes.length}] ` : "";
      const oldSection =
        c.oldText === "" ? "追加到文件末尾" : `旧文:\n${c.oldText}`;
      return `${header}文件: ${c.file}\n理由: ${c.reason}\n${oldSection}\n新文:\n${c.newText}`;
    })
    .join("\n\n──────────────\n\n");
}

export interface DistillerDeps {
  loadPrompt: (name: string) => string;
  runRole: (role: AgentRole, input: AgentInput) => Promise<string>;
}

/**
 * 运行蒸馏器 agent:把门反馈 + 当前 prompt 内容喂给 distiller 角色,
 * 返回解析后的变更列表(空列表=无规律性改动)。
 */
export async function runDistiller(
  feedbacks: GateFeedback[],
  deps: DistillerDeps,
): Promise<ProposedChange[]> {
  const feedbackText = feedbacks
    .map((f) => `${f.gate}: "${f.feedback}"`)
    .join("\n");

  // 只传最可能被改动的 prompt 文件,节省 token
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
