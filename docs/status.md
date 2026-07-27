# 项目状态

更新时间：2026-07-27

## 当前里程碑

- 当前：M1 仓库脚手架与契约
- 状态：实现、本地验收、初始提交和真实 clone 验收完成；GitHub Actions 尚待远端验证
- 下一步：配置 GitHub 远端并取得 `check` workflow 绿色结果；不得自动开始 M2

## M1 已完成

- pnpm workspaces：`apps/api`、`apps/extension`、`packages/contracts`；
- Node 24.14.0、pnpm 11.9.0 和 TypeScript strict 约束；
- ESLint、Prettier、Vitest、Playwright 和单一根命令 `pnpm check`；
- 六个 Draft 2020-12 领域 Schema：
  - VisualSpec；
  - CompileRequest；
  - CompileResponse；
  - ReviseRequest；
  - ReviseResponse；
  - ErrorResponse；
- 对应的 Zod Schema、TypeScript 类型、Schema 元验证和 JSON Schema/Zod 正反样例一致性测试；
- Fastify `GET /health`；
- React + Vite + Chrome Manifest V3 空 Side Panel；
- 扩展权限仅 `sidePanel`、`storage`，无 host permissions；
- `.env.example`、Windows PowerShell 与通用 shell README；
- GitHub Actions workflow；
- pnpm lockfile及仅允许 `esbuild` 构建脚本的供应链策略；
- ADR 0002：领域/API Schema 与未来模型输出 Schema 分离。

## 验证结果

- `pnpm install --frozen-lockfile`：通过；
- `pnpm check`：通过；
  - Prettier：通过；
  - ESLint：通过；
  - 根目录和三个 workspace TypeScript strict：通过；
  - Vitest：15 个测试通过；
  - 三个 workspace 构建通过；
  - Playwright：1 个真实 Chromium unpacked-extension E2E 通过；
- Ajv Draft 2020-12 元验证和相对 `$ref`：通过；
- JSON Schema/Zod 共享正反样例：13 个契约测试通过；
- 编译后 API 实际 HTTP：`{"status":"ok"}`；
- 编译后 manifest 权限检查：通过；
- 扩展 bundle 的 `OPENAI_API_KEY` / `sk-` 扫描：无命中；
- M2+ package 缺失检查：通过；
- `pnpm dev` 同时启动 8787 和 5173：通过；验证后已终止两个子进程；
- 无 `node_modules`/`dist` 的干净临时副本：
  - frozen install：通过；
  - 完整 `pnpm check`：通过；
  - 临时副本已移入回收站，可恢复；
- Git 提交 `155b02ba5cb9cea9594137bfc676af9145d8e395`：
  - `git clone --no-local`：通过；
  - clone 中 frozen install：通过；
  - clone 中完整 `pnpm check`：通过；
  - 验证后 clone 工作树保持干净；
  - 临时 clone 已移入回收站，可恢复；
- 独立对抗性审查：无 P0；状态文档问题已修正。

## 尚未验收

- 本地 `main` 已使用仓库级身份 `zyhp0402 <z13055170115@gmail.com>` 创建初始提交；
- 当前仓库仍没有远端；
- `.github/workflows/check.yml` 尚未在 GitHub Actions 中实际运行，不能声称 CI 绿色；
- 真实本地 clone 已通过，但不能替代 GitHub 托管环境的 CI 结果。

取得仓库和远端后需要：

```text
git clone <repo-url>
cd <repo>
corepack enable
corepack prepare pnpm@11.9.0 --activate
pnpm install --frozen-lockfile
pnpm check
```

并确认 GitHub Actions `check` job 绿色。

## 范围确认

- 未调用 OpenAI API；
- 未实现编译器、renderer、lint 规则或模型 adapter；
- 未创建 `compiler-core`、`openai-adapter`、`evals`；
- 未添加登录、支付、数据库、社区、模型训练或 GitHub 抓取；
- 未把 API Key 放入扩展。

## 已知后续风险

- `taskSpecific` 判别结构仍需在 M2 前定案；
- M3 必须维护最小模型输出 Schema，并在 adapter 组装后再次校验领域 Schema；
- 当前基准集只有 10 条，尚不能证明提示词质量提升；
- 人工偏好发布门槛尚未量化。

## 主要检查命令

- `git init -b main`
- `git add --dry-run .`
- `git check-ignore -v -- playwright-report/index.html`
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
