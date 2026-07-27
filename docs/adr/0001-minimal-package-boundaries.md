# ADR 0001：最小化 Monorepo 包边界

- 状态：接受
- 日期：2026-07-27

## 背景

原计划把提示词模板、lint 规则和通用代码分别建成 workspace。当前只有一个产品和一个编译器消费者；提前拆包会增加 package 配置、构建顺序、导出边界和循环依赖风险，却没有独立部署或复用收益。

## 决策

保留四个职责明确的共享包：

- `contracts`：跨进程数据契约；
- `compiler-core`：纯编译流程，并内含模板、renderer 和 lint 规则；
- `openai-adapter`：唯一的 OpenAI SDK 边界；
- `evals`：M5 的独立评测命令。

不创建 `shared`。跨包代码只有出现明确的第二个消费者时才移动；未来包只在对应里程碑开始时创建，不在 M1 建空壳。

## 后果

- M1 只创建 `contracts`，减少空脚手架和配置重复；
- M2 在 `compiler-core/src/prompts`、`renderer`、`lint` 下组织相关代码；
- M3、M5 分别再创建 `openai-adapter`、`evals`；
- 若某模块需要独立发布、独立版本或被第二个产品消费，再用新 ADR 拆包。
