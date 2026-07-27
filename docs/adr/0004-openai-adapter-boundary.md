# ADR 0004：OpenAI 模型输出与服务端边界

- 状态：接受
- 日期：2026-07-27

## 背景

领域 `VisualSpec` 包含 optional 字段和复杂校验，不能直接作为 strict Structured Outputs schema。官方 JavaScript SDK 使用 `responses.parse`、`zodTextFormat` 与 `output_parsed`，且 strict schema 要求所有字段 required；可选语义必须使用 nullable。

## 决策

- `openai-adapter` 定义更小、全部字段 required 的模型输出 Zod schema，再与用户硬约束组装并通过领域 Schema 校验。
- 文本模型只读取 `OPENAI_TEXT_MODEL`。每个付费请求创建独立 planner，共享 45 秒总 deadline；SDK `maxRetries=0` 且关闭 SDK 日志，adapter 在剩余预算内对可重试错误最多手动重试一次。
- adapter 将超时、429、拒绝、空解析、非法输出和其他上游错误归一化为稳定错误码；不记录简报、固定文字、生成提示词或 API key。
- API 的 compile 请求上限保持 32 KiB；revise 因必须回传完整 VisualSpec 和三方向，单独使用 512 KiB 上限。两条付费路由使用配置化扩展来源 CORS 和默认每分钟 20 次 rate limit。
- `CompileResponse` 和 `ReviseResponse` 在核心组装后及 API 返回前再次通过领域 Zod 契约；模型到 `VisualSpec` 的领域组装失败归一化为 `MODEL_OUTPUT_INVALID`。
- `ReviseRequest` 携带旧 directions。定向且保留其他方向时只重新规划目标 mode，其余方向原样复用；非定向修改使用全部字段 required 的 strict 结构化 patch 更新允许修改的 `VisualSpec` 字段。
- rate limit 只挂在 compile/revise；health、CORS preflight 和 404 不消耗额度。服务端日志只记录 allowlist 元数据，`LOG_LEVEL` 控制级别，不记录 error 对象、请求正文或密钥。

## 后果

- 模型 schema 与领域 schema 有明确边界；M3 的 mock 测试不消耗 OpenAI 额度。
- 更改模型输出结构时只改 adapter 并保持领域契约校验。
- 手动 smoke 必须显式设置 `RUN_OPENAI_SMOKE=1`，CI 不运行真实调用。
- 请求级 planner 隔离 usage 与 deadline，避免并发请求互相污染。
- `previousDirections` 是 private `0.0.0`、尚无发布客户端阶段的 pre-release contract reset，不伪装向后兼容；`schemaVersion` 保持 `1.0.0`，因为尚不存在需要迁移的已发布客户端。
- M3 revision patch 只修改 `goal`、`composition`、`lighting`、主色、`materials`、`background` 和 StyleDNA 公共字段；暂不修改 `camera`、`typography`、硬约束或 task-specific 字段。StyleDNA 更新采用 merge，保留 `timeCharacter`、`graphicLanguage` 等未纳入 patch 的字段；changes 只报告实际变化。
