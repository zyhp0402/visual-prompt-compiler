# ADR 0006：评测边界与版本审批

- 状态：接受
- 日期：2026-07-27

## 背景

M5 需要比较“直接整理输入”的基线与编译器管线，同时不能把离线 mock 指标包装成审美或模型质量结论。评测还必须避免把用户简报、固定文字和生成提示词写入产物，并在 prompt 或 schema 版本漂移时阻止普通检查静默通过。

## 决策

- `packages/evals` 只编排现有 `contracts`、`compiler-core` 和 `openai-adapter`，不复制 OpenAI SDK 接入。
- baseline 使用独立的 `{fullPrompt, compactPrompt}` 结果和自身结构 Schema；不调用 fake planner，不构造 `VisualSpec`、`CompileResponse` 或三方向包装。mock 基线直接拼接输入约束；real baseline 通过现有 adapter 直接扩写标准化输入。compiler 才使用 `compileBrief` 和 planner。
- real 模式必须显式 `--mode real`。根命令在 build 之前检查 `OPENAI_API_KEY` 与 `OPENAI_TEXT_MODEL`；执行函数也在读取基准文件、调用模型和写产物之前重复检查。
- JSONL 在边界映射 `category` 到 `taskType` 并补齐固定默认值；非法 JSON、非法类别、非法 case 和重复 ID 使用稳定错误码。
- 报告只保存 run 元数据、case ID、arm、模型/版本、错误码、计数和指标；不保存 brief、mandatory text、mandatory elements、forbidden elements 或任何 prompt。
- 禁止元素泄漏只统计正向出现；“禁止出现：人物”等负向约束不计为泄漏。冲突检查对两臂都读取实际 prompt，并使用相同的确定性规则。
- 三方向差异同时要求差异轴签名、完整 prompt 和精简 prompt 各自唯一；只改自报标签不能通过。
- 每个比例同时输出 numerator、denominator 和 rate；长度输出 count、total、min、max、average。baseline 每条固定/禁止约束检查两段 prompt，compiler 检查六段。失败 arm 的预期检查数仍进入分母，并单独输出 success coverage。
- arm 失败时先写报告，再以稳定错误 `EVAL_RUN_FAILED` 非零退出。报告只保留稳定错误码。
- `packages/evals/approved-versions.json` 是显式审批记录。prompt、Schema 和 evaluation 各有独立版本与 SHA-256 指纹；对应指纹变化而版本未提升时，批准命令拒绝写入。普通 `pnpm check` 在 CI 中执行同一检查。
- 评测 run 产物被 Git 忽略，只跟踪目录说明。CI 不写评测产物，也不执行 real 模式。

## 后果

- 固定 `--run-id` 与 `--now` 的 mock 报告可复现，可用于回归而非审美判定；空或纯空白基准输入直接拒绝。
- 失败记录能用 `caseId:arm` 定位，敏感输入不进入报告。
- prompt/schema/evaluation 行为变更必须同时提升对应版本并显式批准。
- real 双臂会产生真实模型费用，且结果可能随上游模型变化；因此只允许人工显式运行。
