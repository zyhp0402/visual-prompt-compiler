# ADR 0007：本地案例模式实验边界

- 状态：接受
- 日期：2026-07-28

## 背景

M6 需要验证抽象案例模式是否值得进入编译器，但 Gate A 要求至少 100 个基准输入、清晰权利状态、人工偏好或硬指标收益，以及没有明显近似复制。当前只有 10 个 benchmark，没有人工偏好数据，因此实验不能自动进入 API、Side Panel 或默认主流程。

## 决策

- `CasePattern` 使用独立 Zod/JSON Schema。可发布 fixture 只收录本项目自写、`CC0-1.0`、`rightsStatus: approved` 的 synthetic pattern；不保存 raw prompt，不联网或抓取 GitHub。
- 内容哈希按固定字段顺序覆盖任务类型、抽象设计内容、来源、许可证、署名和权利状态，所有字符串先做 NFKC。仅排除稳定 ID、`contentHash` 和 `importedAt`，因此不同 ID 的相同内容与权利元数据仍能去重，而来源、许可证、署名或权利状态被篡改会触发哈希错误。
- 导入边界只接受 `approved` 与明确允许的 `CC0-1.0`/`CC-BY-4.0`。pending、rejected、NOASSERTION、哈希错误、重复 hash 和同 ID 异内容均产生稳定拒绝码，绝不进入检索。
- 检索是 compiler-core 纯函数：任务类型优先，再按必要输入与 pattern 字段的字符 3-gram Jaccard 排序，同分按 ID。low/medium/high 分别为 topK 1/2/3，跨类型阈值 0.18/0.10/0.05。
- planner 可选上下文仅含 `id`、`license`、`patternSummary`。关闭或无召回时不传上下文，既有编译结果保持 byte-for-byte 不变；API 和 Side Panel 不接入此实验。
- 输出相似度按 faithful/creative/experimental 三个方向分别检查 full/compact 两段 prompt。单段得分取字符 3-gram Jaccard 与 pattern-gram containment（交集 / pattern grams）的较大值，因此原样嵌入较长 prompt 的 patternSummary 得分为 1；方向再聚合两段得分的最大值。阈值仍为 0.72，只报告 mode、max、source ID 和 flagged，不自动改写输出。
- `eval:cases:mock` 固定比较 compiler-no-retrieval 与 compiler-retrieval，两臂使用同一个 case-aware deterministic planner；关闭时沿用原 fake 输出，开启时唯一新增输入是检索得到的 patternSummary。报告只保留 case ID、arm、指标、retrieved ID 和方向级相似度，不保存 brief、patternSummary 或 prompt。
- recommendation 从实际硬指标差异、召回覆盖和方向级相似度动态计算；回归或相似度标记建议 `remove`，否则在样本少于 100 且无人工偏好时建议 `keep_optional`，从不自动切换默认值。
- 可选 pattern context 改变 prompt 行为，新增 Case Schema 改变契约，因此 promptVersion 提升到 `prompt-2`、schemaVersion 提升到 `1.1.0`；case schema、检索、A/B 与 fixtures 同时进入评测指纹。方向相似度修正为 pattern containment 后，evaluationVersion 进一步提升到 `eval-3`。

## 后果

- 当前 mock A/B 只能证明软件边界、确定性和硬指标未回归，不能证明视觉质量提升。
- 当前 case-aware mock 会把召回的 patternSummary 原样注入 prompt，因此 18/30 个方向被如实标记为近似复制；实验建议为 `remove`。这只是 M6 证据结论，不会自动删除实验代码、改写输出或启用产品功能；`ENABLE_CASE_RETRIEVAL=false` 保持不变。
- 只有补足 Gate A 证据后，才讨论 API/UI 接入或默认开启；M6 不实现图片生成、数据库、向量检索或自动采集。
