# 开放问题

日期：2026-07-27

## M1 前

当前没有阻塞 M1 的开放问题。

## 已定案的契约语义

- `needsInput=true` 表示真正阻断，`directions=[]`；非阻断缺失仍返回三个方向并记录风险；
- `aspectRatio.mode=auto` 时 `value=null`；
- assumptions 只以 `normalizedBrief.assumptions` 的对象数组为事实源；
- 方向用 `mode` 定位，不再保留冗余且难以跨项校验唯一性的方向 ID；
- M1 新增独立 ReviseResponse，最小 changes 为 `{path,before,after}[]`，不实现通用 JSON Patch 执行器。

## M2 已定案

- 首版只为 `poster`、`image_edit`、`storyboard` 生成最小 `taskSpecific` 结构；其余任务使用公共字段，且不修改 v1 外部 Schema。见 ADR 0003。

## M3 已定案

- `OPENAI_TEXT_MODEL` 必须由服务端环境变量提供，不设业务代码默认或允许列表；`.env.example` 仅示例当前模型；
- adapter 使用最小 strict-compatible Zod schema，组装后再次校验领域 Schema；
- 每请求共享 45 秒总 deadline；SDK `maxRetries=0`，adapter 在预算内最多手动重试一次。API 默认每分钟 20 次，compile 请求体 32 KiB、revise 请求体 512 KiB。见 ADR 0004。

## M5 前必须决定

1. 人工盲测的最小样本量、评审人数和偏好胜率发布门槛；
2. `originalityRisk` 分数是“越高风险越高”还是“越高越安全”；推荐改名或在契约中固定方向；
3. `estimatedCost` 的货币、价格表日期和计算责任；没有稳定策略时保持可选且不作为精确账单。

## 后续非阻塞

- API 的部署平台和生产域名；
- Chrome Web Store 账号、扩展 ID 与发布权限；
- M6 是否进入默认链路，只能由 M5 后的 A/B 结果决定；
- M7 是否启用图像预览，只能在费用、权限和隐私评审后决定。
