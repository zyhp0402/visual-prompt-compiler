# ADR 0008：GPT Image 2 单图预览边界

- 状态：接受
- 日期：2026-07-28

## 背景

M7 需要让用户用真实图片验证提示词，但图片调用会产生费用，连续自动重试可能重复扣费，图片二进制也不应进入既有本地历史。当前官方 JavaScript SDK 提供 `client.images.generate(...)`，GPT Image 2 返回 `b64_json`；SDK 默认会重试部分 429、连接和 5xx 错误，因此产品必须显式关闭自动重试。

## 决策

- 文本生成使用 Images API 的 `images.generate`，模型由 `OPENAI_IMAGE_MODEL` 配置，默认 `gpt-image-2`。调用固定 `n: 1`、`quality: low`、`output_format: png`，MVP 仅允许 `1024x1024`、`1536x1024`、`1024x1536`。
- 图片契约使用独立 `image-1` 版本，不改变全局 `VisualSpec` 或 `CompileResponse` 的 `schemaVersion`。请求的 source 固定为 `{ kind: "text" }`，为未来参考图留出判别联合边界。
- 参考图未来使用 Images edits 边界；M7 不增加上传、参考图持久化、参考图校验或扩展权限。
- `ENABLE_IMAGE_GENERATION` 默认 `false`。关闭时 `/v1/generate` 返回不可重试的 `SERVICE_UNAVAILABLE`；服务端只有开关开启时才创建并注入真实 image generator。
- SDK client 固定 `maxRetries: 0`。每次按钮操作只调用一次；429、5xx 或超时只返回稳定错误，由用户明确点击“手动重试生成”后才产生下一次付费调用。
- API 在服务端再次强制单图、低质量 PNG，并只记录 request ID、模型、版本、耗时、token 和状态，不记录 prompt 或 base64。
- 服务端在解码前限制 base64 长度，解码后限制为 16 MiB，并检查 PNG 签名、IHDR、请求尺寸与 IEND。
- 预览 base64 只保存在 React 内存中，不进入 `chrome.storage.local`、历史或收藏。刷新、恢复历史、重新编译和 revise 后预览消失。
- Side Panel 同一时刻只允许一张预览在途；结果生命周期变化会使旧请求失效，旧图片和错误不会回灌到新结果。
- 图片失败反馈通过纯函数构造目标方向的 revise instruction，并明确要求保留既有硬约束。UI 只把指令填入现有 revise 表单，用户必须再次显式提交；系统不自动生成第二批图片。

## 后果

- 功能可被彻底关闭，测试全部使用 mock，不消耗真实 OpenAI 额度。
- M7 能验证生成链路与反馈闭环，但不声称图片审美达标，也不包含图片理解模型的自动审查。
- 用户手动重试可能再次产生费用，因此 UI 在每个生成入口持续显示单次付费提示。
