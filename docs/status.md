# 项目状态

更新时间：2026-07-27

## 当前里程碑

- 当前：M2 编译器纯核心
- 状态：实现与本地 clean-build 验收完成，远端 CI 修复待验证
- 远端：https://github.com/zyhp0402/visual-prompt-compiler
- 边界：只实现 `compiler-core` 的纯业务管线，不接 OpenAI，不修改 UI 或 API route
- 下一步：仅在用户明确要求后开始 M3

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
- 清空四个 workspace 的 `dist` 后，`pnpm install --frozen-lockfile` 与完整 `pnpm check` 通过；远端修复结果仍待新 CI run 验证
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
- 未实现模型 adapter，未创建 `openai-adapter` 或 `evals`
- 未增加登录、支付、数据库、社区、模型训练或 GitHub 自动抓取
- 未把 API Key 放入扩展

## 已知后续风险

- M2 fake planner 只用于稳定验证核心管线，不模拟真实模型对 `creativity` 的质量差异
- M3 需维护最小模型输出 Schema，并在 adapter 组装后再次校验领域 Schema
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
- `Invoke-RestMethod http://127.0.0.1:8787/health`
- `rg -a -n 'OPENAI_API_KEY|sk-[A-Za-z0-9]' apps/extension/dist`
- `pnpm -r list --depth -1`
- `gh run watch 30233559713 --repo zyhp0402/visual-prompt-compiler --exit-status`
