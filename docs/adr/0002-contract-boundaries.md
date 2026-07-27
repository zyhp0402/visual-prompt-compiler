# ADR 0002：领域契约与模型输出契约分离

- 状态：接受
- 日期：2026-07-27

## 背景

仓库 JSON Schema 需要验证扩展与 API 之间的完整领域对象；OpenAI strict Structured Outputs 只支持 JSON Schema 子集，不能直接接受当前领域 Schema 的 `allOf` 和可选字段。

## 决策

- `schemas/` 是跨进程领域/API 契约；
- `packages/contracts` 提供对应的严格 Zod Schema 和 TypeScript 类型；
- M1 用共享正反样例验证 JSON Schema 与 Zod 行为一致；
- M3 在 `openai-adapter` 内定义更小的模型输出 Schema，解析后组装领域对象，并再次通过 contracts 校验；
- compile/revise 输入只接受当前请求所需字段；MVP 无服务端持久化，因此 revise 发送完整 `previousSpec`，不接受无法解析的服务端历史 ID。

## 后果

- 不把 OpenAI Schema 限制传播到 UI/API 领域模型；
- JSON Schema 与 Zod 存在双份表达，M1 以一致性测试阻止明显漂移；
- 任何领域契约变更必须同步更新 JSON Schema、Zod、正反样例和 `schemaVersion`。
