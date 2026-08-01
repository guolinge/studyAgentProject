# Plan 3 — Distiller:把门反馈蒸馏成规则写回 prompts/

## Context(为什么做这个)

Plan 1~2d 打通了"问·存·改"完整闭环。但流水线的 prompt 还是死的——用户在门 1/门 2 给了修改意见、纠正了骨架方向,这些经验随着会话消失,下次又要重复纠正。

Plan 3:每次流水线结束后,**Distiller 把门反馈蒸馏成规则**写回 `prompts/*.md` 并 git commit——让 prompt 越用越懂用户。每条改动可回溯(git log)、可回滚(git revert)。

## 已定决策

- **门反馈来源**:门1(问题分析)和门2(内容组织)的非空 reply;不包括查重门(那是选择题,不是规则反馈)。
- **人工批准**:蒸馏结果经用户确认后才写回,不自动修改 prompt。
- **最小改动原则**:只提炼规律性偏好,一次性临时要求不写进 prompt。
- **Distiller 角色用 Haiku**:已在 `agents.config.json` 配置,节省 token。
- **无反馈时跳过**:所有门都直接通过(空反馈)则不运行 Distiller。

## 架构

```
runPipeline → PipelineResult.feedbacks[]
  ↓ (publish 后,若 feedbacks 非空)
runDistiller(feedbacks, loadPrompt)
  → Distiller agent:读反馈 + 当前 prompt 内容 → 输出 ProposedChange[]
  ↓
格式化展示给用户(每条:文件、理由、旧文→新文)
  → 🚪 蒸馏门:用户回车=全部应用,输入"n"=跳过,输入"数字"=仅应用该条
  ↓
applyChange(change, projectRoot):替换/追加到对应 prompts/*.md
  ↓
git commit: "chore(distiller): <文件> - <理由摘要>"
```

## 变更格式(Distiller 输出 → 解析)

```
<<<BEGIN_CHANGE>>>
FILE: prompts/style-rules.md
REASON: 用户在门2多次要求骨架必须包含「时间复杂度」小节
OLD:
旧文(被替换部分;为空则追加到文件末尾)
NEW:
新文
<<<END_CHANGE>>>

<<<NO_CHANGES>>>     ← 若无规律性反馈
```

- `OLD` 为空 → 追加到文件末尾(加空行分隔)
- `OLD` 非空但找不到 → 跳过该条 + 控制台警告,不阻断其他条

## Distiller 输入设计

```
【本次门反馈】
门1 · 确认范围/意图: "话题少了算法复杂度这一块"
门2 · 确认骨架: "第二节要加代码示例,现在太理论了"

【当前 prompts/style-rules.md】
<文件内容>

【当前 prompts/content-organization.md】
<文件内容>
```

只传 `style-rules.md` + 被反馈所涉及的角色 prompt,不全传(节省 token)。

## 任务拆分

### Task 1: 在 orchestrator 收集门反馈
- `types.ts` 新增 `GateFeedback { gate, feedback }`
- `iterateWithGate` 加 `collector?` 参数,非空 reply 时调用
- `PipelineResult` 加 `feedbacks: GateFeedback[]`
- 查重合并提前返回分支也带上 `feedbacks`
- 失败测试 → 实现 → 测试全绿
- commit: `feat: orchestrator 收集门反馈`

### Task 2: prompts/distiller.md + src/distiller.ts
- `prompts/distiller.md`:蒸馏器角色 prompt
- `ProposedChange { file, reason, oldText, newText }`
- `parseDistillerOutput(text)`:解析 `<<<BEGIN_CHANGE>>>` 格式
- `runDistiller(feedbacks, deps)`:拼 system+user → distiller agent → parse
- `applyChange(change, rootDir)`:替换/追加文件
- `formatChangesForApproval(changes)`:人类可读的展示文本
- 失败测试 → 实现 → 测试全绿
- commit: `feat: distiller 模块(解析/应用/展示)`

### Task 3: CLI 装配 + 批准门
- `cli.ts`:publish 后如有 feedbacks,运行蒸馏流程
- 蒸馏门:展示所有变更 → 回车全部应用 / "n" 跳过
- `applyChange` 成功后 `git add <file> && git commit`
- `NO_DISTILLER=1` 开关跳过(调试用)
- commit: `feat: CLI 装配 Distiller + 批准门 + git commit`

## 完成标准(Plan 3 Done)

- [ ] `npm test` 全绿、`npm run typecheck` 无错
- [ ] 有门反馈时 Distiller 自动运行,展示变更候选
- [ ] 用户批准后改动写回 `prompts/*.md` 并 git commit
- [ ] 无反馈时静默跳过;`NO_DISTILLER=1` 可强制跳过
- [ ] 每条改动可通过 git log / git revert 回溯或撤销
