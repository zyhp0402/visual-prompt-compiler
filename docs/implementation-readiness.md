# 实施准备审计

日期：2026-07-27
范围：仅任务 0；未安装依赖、未编写业务代码、未调用 OpenAI API。

## 1. 项目复述

### 用户问题

目标用户能描述业务意图，却未必能把主体、空间关系、层级、镜头、光线、材质、固定文字和禁止项组织成图像模型可执行的提示词。现有“一次扩写”容易漏掉硬约束、混入未经确认的假设，并生成只有措辞差异的多个方案。

### 核心机制

系统采用可检查的两阶段编译：

```text
RawBrief → VisualSpec → 三个差异化方向 → GPT Image 2 自然语言提示词
```

输入先被标准化为与模型语法无关的 `VisualSpec`；确定性规则检查固定文字、必须/禁止元素、比例和显式冲突；稳妥、创意、实验三个方向必须在构图、叙事、媒介、空间等结构轴上不同；必要时最多自动修复一次。质量结论限于契约、可执行性和人工偏好证据，不承诺“美观”。

### MVP 范围

- Chrome Manifest V3 Side Panel，中文单页主流程；
- 简报、比例、类型、固定文字、必须/禁止元素、自由度、输出语言和补全许可；
- `VisualSpec`、三方向规划、renderer、确定性 linter、一次修复；
- 服务端 Responses API 与结构化 JSON，密钥只在服务端；
- 复制、收藏、修改、本地历史，使用 `chrome.storage.local`；
- mock 隔离的单元/集成/E2E 测试与固定基准集。

### 明确非目标

- 登录、多租户、支付、数据库、同步、社区、团队协作；
- 模型训练、默认案例检索、自动抓取 GitHub、大规模向量库；
- 自动操纵 ChatGPT DOM、浏览器保存 API Key；
- 批量图片生产、MVP 内生成图片、艺术家风格模仿快捷功能；
- 对美观、文字生成稳定性或模型确定性的绝对保证。

## 2. PLAN 审查结论

### 已解决

| 级别 | 问题 | 处理 |
|---|---|---|
| 中 | 七个 workspace 对单产品过度拆分，`shared` 无稳定职责 | PLAN 收敛为 `contracts`、`compiler-core`、`openai-adapter`、`evals`；见 ADR 0001 |
| 中 | CompileResponse 只限定三项，未保证三种 mode 各且仅一个 | Schema 增加三组 `contains` 约束 |
| 中 | `needsInput`、auto 比例和 assumptions 存在双重语义 | 已确定：阻断时 `directions=[]`；auto 的 value 为 `null`；assumptions 只以 VisualSpec 对象数组为事实源 |
| 中 | revise、请求和错误只有 prose，没有 M1 契约交付 | TASK_PROMPTS 的 M1 增加最小 CompileRequest、ReviseRequest、ReviseResponse、ErrorResponse |
| 低 | `requestId`、方向标识和关键展示字段允许空字符串 | 增加 UUID 格式或 `minLength` |

### 仍需在对应里程碑解决

| 级别 | 发现 | 最小处理 |
|---|---|---|
| 高 | `taskSpecific` 是任意 object，既不能表达海报/编辑/分镜扩展，也不利于严格结构化输出 | M2 只为实际实现的任务类型定义判别联合；不要在 M1 猜全量字段 |
| 高 | 领域/API Schema 已确定不兼容 OpenAI strict Structured Outputs：含 `allOf`，且部分对象字段可选 | M3 使用独立的最小模型输出 Schema；模型结果解析后由 adapter 组装并以领域 Schema 再校验 |
| 高 | M3 没有指定文本模型，只要求环境变量；并非所有模型支持 Structured Outputs | M3 启动时从官方模型页选定支持 Structured Outputs 的文本模型并做启动校验；图像模型不用于产出该 JSON |
| 中 | “模型审查层”评分来源、确定性和费用不清，可能增加一次额外模型调用 | MVP 默认由同一次规划输出评分；只有评测证明有收益才增加 critic 调用 |
| 中 | “分阶段响应”出现在风险缓解，但 API 契约和 M3/M4 无流式要求 | MVP 不实现流式；先测延迟，再决定 |
| 中 | 发布门含人工偏好胜率“预设门槛”，但门槛尚未给出 | M5 前由产品方设定样本量、胜率门槛和置信规则 |
| 低 | `estimatedCost` 没有货币和计价版本 | M3 可先返回 token usage；成本字段在有稳定价格表策略前保持可选 |
| 低 | fixtures 只有 10 条，M0 目标是 10–20，已达下限但覆盖不均 | M5 前补齐明确计算规则和边界样例，不阻塞 M1 |

OpenAI 官方当前资料确认：strict Structured Outputs 只支持 JSON Schema 子集，不支持 `allOf`，并要求对象字段全部 required；Responses 的结构化输出还依赖所选文本模型是否支持该能力。GPT Image 2 是后续图像生成模型，不支持结构化输出。因此领域/API Schema 与模型输出 Schema 分离，两种模型也保持独立配置和职责。来源：[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)、[GPT Image 2](https://developers.openai.com/api/docs/models/gpt-image-2)。

## 3. 最终推荐技术栈

维持 PLAN 的技术栈，不创建技术栈变更 ADR：

| 层 | 选择 | 理由 |
|---|---|---|
| 工作区 | pnpm workspaces，不加 Turborepo | 原生命令足以覆盖四个包，减少一层编排 |
| 语言 | TypeScript strict | 同一语言覆盖扩展、API、契约和测试 |
| 扩展 | React + Vite + MV3 原生 manifest | UI 状态适合 React；Vite 足够，不引入扩展框架 |
| API | Node.js LTS + Fastify | 原生 JSON Schema/Ajv 路由校验、低样板、内建日志 |
| 契约 | JSON Schema 2020-12 + Zod 对应实现 | 保留仓库 Schema 为外部契约；Zod 服务核心/客户端边界；M1 加漂移测试 |
| OpenAI | 官方 JS/TS SDK + Responses API | 单一受控 adapter，便于 mock、超时和错误归一化 |
| 测试 | Vitest + Playwright | 统一 TS 单元/集成测试，并覆盖真实 MV3 加载边界 |
| 本地存储 | `chrome.storage.local` | 满足单用户历史/收藏，无数据库需求 |
| CI | GitHub Actions | M1 只跑安装、`pnpm check`、构建；不调用真实 API |

M1 需要声明的直接依赖/开发依赖类别：React/Vite、Fastify、Zod、TypeScript、ESLint、Prettier、Vitest、Playwright、Chrome 类型，以及 Fastify 的 CORS/rate-limit 插件。实际版本必须在 M1 安装时锁定并记录；任务 0 不安装。

## 4. M0 指标计算口径

| 指标 | 计算 |
|---|---|
| 首次可用率 | 首次成功编译后、任何 revise 前发生复制或收藏的会话数 / 首次成功编译会话数 |
| 硬约束保留率 | 在最终三方向中通过的硬约束断言数 / 应检查的硬约束断言总数 |
| 禁止内容违规率 | 正向提示词命中任一禁止项的方向数 / 已评测方向总数 |
| 三方向差异合格率 | 三种 mode 各一，且差异轴包含至少一个非纯配色/形容词结构轴的会话数 / 三方向响应会话数 |
| 复制率、收藏率 | 至少发生一次对应事件的成功编译会话数 / 成功编译会话数 |
| 再次重写率 | 首次成功编译后发生 revise 的会话数 / 首次成功编译会话数 |
| 人工偏好胜率 | 盲测中 compiler 胜场 / 排除平局后的胜负总场；平局率单独报告 |
| P50/P95 延迟 | 成功请求端到端 `latencyMs` 的第 50/95 百分位；超时率另报 |
| 单次编译估算成本 | 同一价格表版本下估算成本之和 / 成功编译数；记录货币和价格表日期 |
| 输出解析失败率 | 无法解析或未通过领域 Schema 的模型响应数 / 模型响应总数 |
| 案例相似度泄漏率 | M6 开启检索时超过预设相似度阈值的方向数 / 启用检索的方向总数 |

fixtures 中的 `expected` 布尔值是断言标签，不是测量结果；M5 runner 必须把每个标签映射到可复现检查，无法自动化的标签进入人工盲测，不得伪造布尔结果。

## 5. Schema 检查

### VisualSpec

- JSON 文件可解析并声明 Draft 2020-12；任务 0 环境没有现成 validator，完整元 Schema 验证留给 M1；
- 公共字段足以承载一般场景和 M1 契约骨架；
- 固定文字、场景关系、层级、假设、未解决问题和风险有明确结构；
- `aspectRatio.mode=auto` 时 `value` 已固定为 `null`；
- `taskSpecific` 尚不能支撑 M2–M4 的编辑/分镜等可测试扩展；
- 已确定不能直接作为 OpenAI strict Structured Outputs Schema；它保留为领域/API 契约，M3 另建最小模型输出 Schema。

### CompileResponse

- JSON 文件可解析并声明 Draft 2020-12，相对 `$ref` 目标存在；完整元 Schema 验证留给 M1；
- `needsInput=true` 时方向为空；否则恰好三项，且 faithful/creative/experimental 各且仅一个；
- 可承载 M4 展示所需的概念、差异轴、双提示词、约束、风险和评分；
- 顶层重复 assumptions 已删除；方向用唯一 `mode` 定位，不再保留冗余方向 ID；
- M1 需新增独立 ReviseResponse，其最小 `changes` 为 `{path,before,after}[]`。

结论：两个 Schema 足以进入 M1 的契约脚手架，但不是 M2–M4 的冻结终版。M1 应加入正/反样例和 `$ref` 解析检查；任何后续语义变更必须提升 `schemaVersion` 或在尚未发布前明确重置 v1 草案。

## 6. 最终 Monorepo 结构

```text
/
├─ apps/
│  ├─ extension/
│  │  ├─ public/manifest.json
│  │  ├─ src/sidepanel/
│  │  ├─ src/features/{brief,results,history}/
│  │  ├─ src/lib/{api,storage}/
│  │  └─ tests/
│  └─ api/
│     ├─ src/{config,routes}/
│     ├─ src/server.ts
│     └─ tests/
├─ packages/
│  ├─ contracts/          # M1
│  ├─ compiler-core/      # M2；含 prompts、renderer、lint
│  ├─ openai-adapter/     # M3
│  └─ evals/              # M5
├─ schemas/
├─ fixtures/
├─ docs/
│  ├─ adr/
│  ├─ implementation-readiness.md
│  ├─ open-questions.md
│  └─ status.md
├─ scripts/
├─ .github/workflows/check.yml
├─ package.json
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ eslint.config.js
├─ .prettierrc.json
├─ .env.example
├─ README.md
├─ AGENTS.md
├─ PLAN.md
└─ TASK_PROMPTS.md
```

未来包按里程碑创建；M1 不创建空的 M2/M3/M5 package。

## 7. M1 原子任务与验证

| 顺序 | 原子任务 | 独立通过标准 |
|---|---|---|
| 0 | 安装 M1 已批准工具链后，对两个现有 Schema 做 Draft 2020-12 元验证 | 两个 Schema 与相对 `$ref` 均通过；失败则停止后续脚手架 |
| 1 | 创建根 workspace、Node/pnpm 版本约束和基础 ignore | `pnpm -r list` 只发现预期 workspace |
| 2 | 配置 TS strict、ESLint、Prettier、Vitest 根约定 | 一个最小 TS 文件能分别通过 typecheck/lint/format |
| 3 | 建 `packages/contracts`，纳入领域 Schema/Zod/TS 类型，并补最小 CompileRequest、ReviseRequest、ReviseResponse、ErrorResponse | 正样例通过；缺字段、多字段、阻断方向、auto 比例、重复 mode 反例符合预期；JSON Schema 与 Zod 结果一致 |
| 4 | 建 `apps/api` 与 `/health` | 进程可启动，HTTP 200 且响应契约通过；无 OpenAI 依赖/调用 |
| 5 | 建 `apps/extension` 空 Side Panel | 构建成功；Chrome 开发者模式可加载；权限仅 `sidePanel`、`storage` |
| 6 | 添加根脚本 `dev/build/test/lint/typecheck/format:check/check` | 每个脚本可单独运行，`pnpm check` 一次通过 |
| 7 | 添加 `.env.example` 和 README | 从干净目录按 PowerShell 与通用 shell 步骤可复现安装、检查、启动 |
| 8 | 添加 CI | 与本地相同 Node/pnpm 版本运行 `pnpm check` 和 build，不需要 secret |
| 9 | 做真实边界验收并更新状态 | 全新 clone 检查、health HTTP、Chrome 加载证据和 CI 结果均记录 |

不要并行堆脚手架后再统一修错。建议按 0→1→2→3→4→5→6→7→8→9 执行；第 4、5 步在共享配置稳定后可独立进行。

## 8. 外部凭据

M1 不需要任何外部凭据，缺少下列项不阻塞 M1：

- M3：`OPENAI_API_KEY`、获准使用且支持 Structured Outputs 的文本模型名称；
- M7：GPT Image 2 访问权限、可计费 API 项目/组织配置，及届时官方要求的组织验证；
- 部署联调：API 部署目标的环境变量管理权限、最终扩展 ID/允许来源；
- M8 发布：Chrome Web Store 开发者账号和发布权限；
- CI 若使用私有部署或真实 smoke test：对应平台 secret；默认 CI 不需要。

任何凭据只进入服务端环境或 secret 管理，不写入仓库、扩展 bundle、日志或文档样例。

## 9. 准备状态

任务 0 的审计和准备工作已完成，没有凭据阻塞。受“任务 0 禁止安装依赖”约束，完整 Draft 2020-12 元验证无法在当前环境执行；M1 必须把安装工具链后的 Schema 元验证设为第一道门，失败则不得继续 API/扩展脚手架。Node LTS 主版本和 package manager 固定方式可由 M1 采用当时稳定 LTS + Corepack 的最小默认并在 README 记录。
