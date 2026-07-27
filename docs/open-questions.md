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

## M3 前必须决定

1. `OPENAI_TEXT_MODEL` 的默认值和允许列表是什么？必须选择当时官方标注支持 Responses API Structured Outputs 的文本模型；不要把 `gpt-image-2` 用于结构化规划。
2. 模型输出专用 Schema 的最小字段集合是什么？领域 Schema 已确定因 `allOf` 和可选字段不能直接用于 strict Structured Outputs；adapter 必须解析最小模型输出，再组装并校验领域响应。
3. 超时、有限重试和 rate limit 的具体默认值是什么？推荐先用 PLAN 的 45 秒总超时、仅对可重试上游错误重试一次；额度数据出现后再调。

## M5 前必须决定

1. 人工盲测的最小样本量、评审人数和偏好胜率发布门槛；
2. `originalityRisk` 分数是“越高风险越高”还是“越高越安全”；推荐改名或在契约中固定方向；
3. `estimatedCost` 的货币、价格表日期和计算责任；没有稳定策略时保持可选且不作为精确账单。

## 后续非阻塞

- API 的部署平台和生产域名；
- Chrome Web Store 账号、扩展 ID 与发布权限；
- M6 是否进入默认链路，只能由 M5 后的 A/B 结果决定；
- M7 是否启用图像预览，只能在费用、权限和隐私评审后决定。
