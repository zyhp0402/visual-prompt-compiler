# ADR 0003：编译器核心的表示、检查与方向策略

- 状态：接受
- 日期：2026-07-27

## 背景

M2 需要在不接入 OpenAI 的情况下稳定验证编译流程。若规划结果直接等同于 GPT Image 2 提示词，约束检查、修改和未来更换 renderer 都会依赖一段不可检查的文本；若把所有质量判断都当成阻断错误，又会把主观评分误作事实。

## 决策

- `VisualSpec` 保存与具体模型语法无关的用户意图和硬约束；renderer 单向读取规格与方向计划，输出 GPT Image 2 自然语言。更换 renderer 不改变领域契约。
- 确定性、可证伪的违规是硬错误，例如固定文字缺失、禁止项泄漏、显式光线冲突和三方向缺少结构差异；0–100 分只产生软警告，不单独阻断结果，也不证明“美观”。
- 三方向必须分别使用至少一个结构差异轴，首版允许：构图结构、视觉叙事、媒介、空间组织、镜头策略、材料系统、图形语言。只改色彩或形容词不合格。
- 首版 `taskSpecific` 只为 `poster`、`image_edit`、`storyboard` 生成最小结构；其他任务继续使用公共字段，不扩张 v1 外部 Schema。
- planner 是 `compiler-core` 唯一依赖接口。M2 使用确定性 fake；自动 repair 只调用一次，修复后重新执行同一 lint，不循环。
- revise 的目标方向与保留策略通过一次调用内的 planning context 传递，不写入 `VisualSpec`；`VisualSpec` 只保存可复用的视觉意图。

## 后果

- `compileBrief` 与 `reviseCompilation` 可脱离 UI、Fastify 和 OpenAI 独立测试；
- renderer、lint 和 repair 行为可由固定 fixtures 回归；
- M3 只需实现 planner adapter，不需要改写核心编排；
- 分数阈值和更多 `taskSpecific` 类型只有在评测或真实需求出现时再扩展。
- M3 起 `ReviseRequest` 携带旧 directions；定向修改只规划目标方向，核心按 mode 合并并原样保留其余方向。模型调用上下文不写入 `VisualSpec`。
