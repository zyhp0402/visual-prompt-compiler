# Visual Prompt Compiler — Codex 启动说明

本目录是一套可以直接交给 Codex 执行的项目计划。

## 文件说明

- `PLAN.md`：完整产品与工程计划，是项目的单一事实来源。
- `AGENTS.md`：Codex 每次进入仓库时都应遵守的长期工程规则。
- `TASK_PROMPTS.md`：按里程碑拆分的 Codex 指令，禁止一次性实施全部功能。
- `schemas/visual-spec.schema.json`：中间视觉规格 `VisualSpec` 的初始 JSON Schema。
- `schemas/compile-response.schema.json`：编译接口返回结构的初始 JSON Schema。
- `fixtures/benchmark-cases.jsonl`：首批基准测试样例。

## 推荐使用方式

1. 新建一个空 Git 仓库。
2. 将本目录全部文件复制到仓库根目录。
3. 在 Codex 中打开该仓库。
4. 首次只执行 `TASK_PROMPTS.md` 中的“任务 0”。
5. 每个里程碑必须满足验收门后，才允许执行下一个任务。
6. 不允许 Codex自行扩大范围、加入登录、支付、社区、模型训练或自动网页操纵。

## 第一条可直接发送给 Codex 的指令

```text
请先完整阅读 AGENTS.md、PLAN.md、TASK_PROMPTS.md 和 schemas/。
只执行 TASK_PROMPTS.md 的“任务 0：仓库审计与实施准备”，不要开始编码产品功能。
输出：
1. 你对项目目标和非目标的复述；
2. 发现的矛盾、缺口和风险；
3. 建议的最终技术栈与理由；
4. 拟创建的目录树；
5. M1 的原子任务清单；
6. 需要我提供的外部凭据清单。
将结论写入 docs/implementation-readiness.md。
除非缺少会阻止 M1 的信息，否则不要提问。
```

## 核心原则

这个项目不是“关键词拼接器”，也不是“提示词收藏夹”。它是一个可评测的提示词编译系统：

```text
用户意图
→ 需求标准化
→ VisualSpec 中间表示
→ 确定性规则检查
→ 多方向规划
→ GPT Image 2 提示词渲染
→ 质量审查与修复
→ 用户复制、修改或生成预览
```
