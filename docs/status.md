# 项目状态

更新时间：2026-07-27

## 当前里程碑

- 当前：M5 评测、回归与发布门槛
- 状态：M5 实现、本地独立验收、远端 CI 均完成
- 远端：https://github.com/zyhp0402/visual-prompt-compiler
- 边界：只实现 M5 评测，不生成图片，不执行真实 OpenAI 调用，不开始 M6
- 下一步：等待用户验收；后续里程碑必须由用户明确要求

## M5 已完成

- 新增 strict TypeScript `packages/evals`，复用 contracts、compiler-core 与 openai-adapter
- JSONL 解析将 category 映射为 CompileRequest taskType，空输入、非法 case 和重复 ID 使用稳定边界错误码
- baseline 使用独立两段 prompt 结果与独立 Schema/指标入口，不调用 fake planner 或构造编译器响应；mock compiler 使用现有 compileBrief 与 deterministic fake planner
- real 仅在显式模式启用；根命令缺少 key/model 时在 build、读输入、调用和写产物前失败
- 每 case/arm 输出 success coverage、各自 Schema、固定文字、禁止元素正向泄漏、共同冲突规则、方向差异和长度指标
- 所有比例带 numerator/denominator/rate；失败仍进入约束分母；所有长度带 count/total/min/max/average
- JSON/Markdown 报告只保存 ID、元数据和指标，不保存简报、固定文字或提示词
- arm 失败先写可定位报告，再以 `EVAL_RUN_FAILED` 非零退出
- 固定 run-id 与 now 的 mock 报告可复现；run 产物忽略，只跟踪目录说明
- tracked prompt/schema/evaluation 三套版本和行为指纹审批文件与 check/approve 命令
- ADR 0006：评测边界与版本审批

## M5 验收结果

- 远端提交 [`bb232c0`](https://github.com/zyhp0402/visual-prompt-compiler/commit/bb232c0)；GitHub Actions 绿色运行 [`30259047706`](https://github.com/zyhp0402/visual-prompt-compiler/actions/runs/30259047706)
- `packages/evals`：22 个测试通过，strict typecheck 与 build 通过；openai-adapter 16 个、compiler-core 21 个窄测通过
- 固定 mock：10 个 case、20 个 arm record，success/schema 均 20/20；baseline 固定文字 14/14、禁止项 0/28，compiler 固定文字 42/42、禁止项 0/84；两臂共同规则各检出 1 个冲突，compiler 三方向差异 10/10
- `pnpm eval:versions`：`prompt-1` / `1.0.0` / `eval-1` 与三套 SHA-256 审批记录一致
- real 根命令缺凭据检查：在 build、读取不存在的输入和写产物前返回 `EVAL_REAL_CREDENTIALS_MISSING`
- `pnpm eval:mock` 根命令：生成 JSON 与 Markdown，产物被 Git 忽略
- `pnpm check`：Prettier、ESLint、strict typecheck、106 个 Vitest、全部 workspace build、三套版本门禁和 2 个 Playwright E2E 全部通过
- 首次全量检查的第二条既有 E2E 曾在 30 秒超时；单独重跑和随后完整重跑均通过，未修改 M4 代码
- 未调用真实 OpenAI API

## M4 已完成

- 中文简报表单：自动/手动任务类型、比例、固定文字、必须/禁止元素、创意自由度和折叠高级设置
- 暖灰纸面、深墨文字、朱红批注的“编辑台/校样纸”侧边栏；本机中文字体栈、可见焦点和 reduced-motion
- API 客户端读取 `VITE_API_BASE_URL`，默认 `http://127.0.0.1:8787`
- 使用共享 contracts 校验 CompileResponse、ReviseResponse 和 ErrorResponse
- 展示标准化 VisualSpec 摘要、假设、风险、三方向、完整/精简提示词、复制反馈和定向 revise
- revise 发送完整 `previousSpec`、三份 `previousDirections` 并保留非目标方向
- 单键 `chrome.storage.local` v2 状态；v1 迁移删除原始 request/brief，历史只保存结果与最小派生标签
- hydration 与 functional update 使用同一串行队列；非规范数据在 load 返回前物理回写 sanitized v2
- 串行 update 避免延迟 load 或异步历史写入覆盖并发设置、收藏或清空
- 递增 operation id 防止慢请求在新建或恢复后回灌；新 compile 立即移除旧结果
- 清空不取消在途网络请求；独立 history generation 让结果照常展示但不重写已清空历史
- 历史、收藏、清空、回放及设置/存储异步错误提示
- compile/revise/恢复成功 aria-live 播报、结果焦点管理和清空前稳定焦点转移
- timeout、offline、rate limited、invalid output、upstream 与 invalid request 状态及可重试路径
- host permissions 仅新增 `http://127.0.0.1/*` 和 `http://localhost/*`
- ADR 0005：扩展本地状态与 API 边界

## M4 验收结果

- 扩展单测：19 个通过，覆盖 API 错误分类、body 阶段超时、contracts 响应校验、storage 物理隐私迁移/损坏回退/容量上限、排队 hydration 与并发写入
- 扩展 TypeScript strict 与生产构建：通过
- 真实 unpacked Chromium E2E：2 个通过
  - 本地 mock HTTP server 下完成表单 compile、三方向、复制、收藏/历史持久化和定向 revise
  - 可控覆盖 timeout、offline、rate-limit 和 invalid-output
  - 验证敏感 brief 不进入 storage、慢请求不回灌、成功后失败不保留旧结果、成功/恢复/清空焦点
  - 预置含敏感 request 的 v1 storage，打开后验证物理删除；慢请求期间清空历史仍展示结果且历史保持为空
- `pnpm check`：通过
  - Prettier、ESLint、TypeScript strict：通过
  - Vitest：83 个测试通过
  - 五个 workspace 构建：通过
  - Playwright Chromium E2E：2 个通过
- GitHub Actions run `30249241106` 首次失败：clean env 中根 E2E typecheck 无法解析尚未构建的 `@vpc/contracts` 类型，连带产生 direction 隐式 `any`
- 最小修复：根 `tsconfig.json` 按现有 workspace 模式把 contracts 映射到源码，并为 E2E direction 增加由 fixture 数组派生的显式类型；移走全部 workspace dist 后 frozen install 与完整 `pnpm check` 通过
- GitHub Actions 修复验证：run `30250024999` 绿色
  - https://github.com/zyhp0402/visual-prompt-compiler/actions/runs/30250024999
- manifest 权限扫描：未新增 `activeTab`、`<all_urls>`、`contextMenus` 或 `unlimitedStorage`
- 未设置 `OPENAI_API_KEY`，未调用真实 OpenAI

## M3 已完成

- `openai-adapter` 使用官方 SDK `responses.parse`、`zodTextFormat` 与 `output_parsed`
- strict-compatible 最小模型输出 Schema，组装后复验领域 `VisualSpec`、`CompileResponse` 和 `ReviseResponse`
- `OPENAI_TEXT_MODEL` 环境配置、请求级 45 秒总 deadline、SDK 零重试与预算内最多一次手动重试
- compile/revise 路由、Zod 边界校验和稳定 ErrorResponse
- 请求级 planner/usage、定向 revise 原样保留其余方向、非定向 strict patch
- 配置化扩展来源 CORS、付费路由默认 20/min rate limit、compile 32 KiB 与 revise 512 KiB 独立请求体上限
- allowlist 结构化日志，包含真实 repair 状态；`LOG_LEVEL` 生效且不记录正文、提示词、错误对象或密钥
- 超时、429、上游错误、拒绝、空解析和非法输出归一化
- mock 集成测试与默认禁用的手动 smoke 脚本
- ADR 0004：模型输出 Schema 与服务端配置边界

## M3 验收结果

- Node 24.14.0、pnpm 11.9.0
- contracts：13 个契约与 parity 测试通过
- compiler-core：21 个测试通过
- adapter：15 个 mock 测试通过
- API：15 个测试通过
- `pnpm check`：通过
  - Prettier、ESLint、TypeScript strict：通过
  - Vitest：65 个测试通过
  - 五个 workspace 构建：通过
  - Playwright Chromium E2E：1 个通过
- GitHub Actions run `30245314997` 绿色
  - https://github.com/zyhp0402/visual-prompt-compiler/actions/runs/30245314997
- 未设置 `OPENAI_API_KEY`，未执行真实 OpenAI smoke

## M2 已完成

- 输入标准化、VisualSpec 构建接口和 deterministic fake planner
- 稳妥、创意、实验三方向及 GPT Image 2 自然语言 renderer
- 硬规则与软评分分离的确定性 lint
- 最多一次 repair，并在修复后重新执行同一 lint
- `compileBrief` 与 `reviseCompilation` 纯业务编排
- `poster`、`image_edit`、`storyboard` 的最小 `taskSpecific` 结构
- 10 条 fixtures 的稳定结构回归，以及 normalizer、冲突、定向 revise、阻断问题等核心分支测试
- ADR 0003：中间表示、规则分层与方向差异策略

## M2 验收结果

- GitHub Actions run `30236795009` 首次失败：干净环境没有 `packages/contracts/dist`，`compiler-core` typecheck 通过包 exports 找不到 contracts 类型；本地残留 dist 掩盖了该问题
- 修复：开发态 typecheck 通过 TypeScript paths 解析 contracts 源码，Vitest 使用 `development` export，build 仍解析 contracts 的 dist 声明
- 清空四个 workspace 的 `dist` 后，`pnpm install --frozen-lockfile` 与完整 `pnpm check` 通过
- GitHub Actions 修复验证：run `30237240786` 绿色
  - https://github.com/zyhp0402/visual-prompt-compiler/actions/runs/30237240786
- 固定运行时：Node 24.14.0、pnpm 11.9.0
- `pnpm --filter @vpc/compiler-core test`：18 个测试通过
- `pnpm --filter @vpc/compiler-core typecheck`：通过
- `pnpm --filter @vpc/compiler-core... build`：通过
- `pnpm check`：通过
  - Prettier、ESLint、TypeScript strict：通过
  - Vitest：33 个测试通过
  - 四个 workspace 构建：通过
  - Playwright：真实 Chromium unpacked-extension E2E 通过

## M1 已完成

- pnpm workspace：`apps/api`、`apps/extension`、`packages/contracts`
- Node 24.14.0、pnpm 11.9.0、TypeScript strict
- ESLint、Prettier、Vitest、Playwright 和统一命令 `pnpm check`
- 六个 Draft 2020-12 JSON Schema：
  - VisualSpec
  - CompileRequest
  - CompileResponse
  - ReviseRequest
  - ReviseResponse
  - ErrorResponse
- 对应的 Zod Schema、TypeScript 类型和正反样例一致性测试
- Fastify `GET /health`
- React + Vite + Chrome Manifest V3 空 Side Panel
- 扩展权限仅 `sidePanel`、`storage`，无 host permissions
- `.env.example`、README、GitHub Actions workflow、pnpm lockfile
- ADR 0002：领域 API Schema 与未来模型输出 Schema 分离

## 验收结果

- `pnpm install --frozen-lockfile`：通过
- `pnpm check`：通过
  - Prettier、ESLint、TypeScript strict：通过
  - Vitest：15 个测试通过
  - 三个 workspace 构建：通过
  - Playwright：真实 Chromium unpacked-extension E2E 通过
- Ajv Draft 2020-12 元验证、相对 `$ref`：通过
- 编译后 API 实际 HTTP 响应：`{"status":"ok"}`
- manifest 权限检查：通过
- 扩展 bundle 敏感信息扫描：无命中
- M2+ package 缺失检查：通过
- 真实本地 `git clone --no-local` 后 frozen install 与完整 `pnpm check`：通过
- 独立对抗性审查：无 P0
- GitHub Actions `check`：通过
  - 运行：https://github.com/zyhp0402/visual-prompt-compiler/actions/runs/30233559713

## 范围确认

- 未调用 OpenAI API
- 已创建纯 `compiler-core`，包含 deterministic fake planner、renderer、lint 与最多一次 repair
- 已实现 `openai-adapter` 和 compile/revise 服务端路由
- 已实现 M4 Side Panel 主流程、版本化本地历史与收藏
- 已创建 `evals` 并完成 M5 离线评测；未实现图片生成或 M6
- 未增加登录、支付、数据库、社区、模型训练或 GitHub 自动抓取
- 未把 API Key 放入扩展

## 已知后续风险

- M2 fake planner 只用于稳定验证核心管线，不模拟真实模型对 `creativity` 的质量差异
- M3 最小模型输出 Schema 与领域复验已完成；因未提供 API Key，真实 OpenAI smoke 尚未验收
- M4 E2E 使用本地 mock API；真实 OpenAI 驱动的端到端内容质量仍未验收
- 当前基准集仅 10 条，不能证明提示词质量提升
- 人工偏好发布门槛尚未量化

## 主要检查命令

- `git clone --no-local <local-repo> <temp-clone>`
- `pnpm install --frozen-lockfile`
- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm test:e2e`
- `pnpm check`
- `pnpm --filter @vpc/extension test`
- `pnpm --filter @vpc/extension typecheck`
- `pnpm --filter @vpc/extension build`
- `Invoke-RestMethod http://127.0.0.1:8787/health`
- `rg -a -n 'OPENAI_API_KEY|sk-[A-Za-z0-9]' apps/extension/dist`
- `pnpm -r list --depth -1`
- `gh run watch 30233559713 --repo zyhp0402/visual-prompt-compiler --exit-status`
- `gh run watch 30237240786 --repo zyhp0402/visual-prompt-compiler --exit-status`
- `gh run watch 30245314997 --repo zyhp0402/visual-prompt-compiler --exit-status`
- `gh run watch 30249241106 --repo zyhp0402/visual-prompt-compiler --exit-status`
- `gh run watch 30250024999 --repo zyhp0402/visual-prompt-compiler --exit-status`
