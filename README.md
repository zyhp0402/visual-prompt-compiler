# Visual Prompt Compiler

Chrome Manifest V3 Side Panel + Fastify 的 pnpm monorepo。当前完成 M5：除中文侧边栏和 compile/revise 主流程外，提供可复现的离线双臂评测与显式 real 评测入口。

## 前置条件

- Node.js 24.14.x；
- Corepack；
- Chromium（只用于扩展 E2E；可由 Playwright 安装）。

## Windows PowerShell

```powershell
corepack enable
corepack prepare pnpm@11.9.0 --activate
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm check
```

开发：

```powershell
pnpm dev
```

构建并加载扩展：

```powershell
pnpm build
```

打开 `chrome://extensions`，启用“开发者模式”，选择“加载已解压的扩展程序”，加载：

```text
apps\extension\dist
```

首次加载后，在 `chrome://extensions` 复制扩展 ID，把实际来源加入服务端环境变量：

```dotenv
ALLOWED_EXTENSION_ORIGINS=chrome-extension://<id>
```

扩展 API 基址由根目录 `.env` 的 `VITE_API_BASE_URL` 在构建时注入，未设置时默认：

```dotenv
VITE_API_BASE_URL=http://127.0.0.1:8787
```

修改 API 基址后需要重新执行 `pnpm build`。扩展只申请
`http://127.0.0.1/*` 和 `http://localhost/*` 两个本机 host permissions。

验证 API：

```powershell
pnpm --filter @vpc/api build
$process = Start-Process node -ArgumentList 'apps/api/dist/server.js' -WindowStyle Hidden -PassThru
Invoke-RestMethod http://127.0.0.1:8787/health
Stop-Process -Id $process.Id
```

预期响应：

```json
{ "status": "ok" }
```

## macOS / Linux shell

```sh
corepack enable
corepack prepare pnpm@11.9.0 --activate
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm check
```

开发与构建：

```sh
pnpm dev
pnpm build
```

验证 API：

```sh
pnpm --filter @vpc/api build
node apps/api/dist/server.js &
api_pid=$!
curl http://127.0.0.1:8787/health
kill "$api_pid"
```

Chrome/Chromium 中加载 `apps/extension/dist`，再把
`chrome-extension://<id>` 加入 `ALLOWED_EXTENSION_ORIGINS`。

## 根命令

- `pnpm dev`：并行启动 API 和扩展 Vite 开发服务；
- `pnpm build`：构建全部 workspace；
- `pnpm test`：运行 Vitest；
- `pnpm lint`：运行 ESLint；
- `pnpm typecheck`：运行 TypeScript strict 检查；
- `pnpm format:check`：检查格式；
- `pnpm test:e2e`：真实加载构建后的 unpacked extension；
- `pnpm eval:mock`：运行离线双臂基准并写本地产物；
- `pnpm eval:real`：显式运行真实双臂基准；
- `pnpm eval:versions`：检查 prompt/schema 版本审批记录；
- `pnpm eval:approve`：显式更新版本审批记录；
- `pnpm check`：依次执行全部检查、构建和 E2E。

## 环境变量

复制 `.env.example` 后仅在服务端环境填写 `OPENAI_API_KEY`、`OPENAI_TEXT_MODEL` 和允许的扩展来源。`VITE_API_BASE_URL` 只包含 API 地址；密钥不得进入扩展 bundle 或 `chrome.storage.local`。

真实 OpenAI smoke test 默认禁用。先启动 API，再显式执行：

```powershell
$env:RUN_OPENAI_SMOKE='1'
node scripts/smoke-openai.mjs
```

CI 只运行 mock，不执行该脚本。

## 评测

默认 mock 使用 10 条基准用例，不调用 OpenAI：

```powershell
pnpm eval:mock -- --run-id local-mock --now 2026-07-27T00:00:00.000Z
```

产物写入 `artifacts/evals/<run-id>.json` 和 `.md`，但不会进入 Git。报告只包含 case ID、计数和指标，不保存简报、固定文字或提示词。baseline 只评估直接扩写得到的完整/精简两段 prompt；compiler 评估三个方向的六段 prompt，因此约束指标始终同时显示各自的 numerator/denominator。指标验证契约行为，不代表视觉质量或审美提升。

真实双臂评测必须显式执行并提供服务端凭据：

```powershell
$env:OPENAI_API_KEY='<server-only-key>'
$env:OPENAI_TEXT_MODEL='<approved-structured-output-model>'
pnpm eval:real -- --run-id manual-real
```

缺少任一变量时，根命令会在 build、读取输入、调用模型和写产物之前返回 `EVAL_REAL_CREDENTIALS_MISSING`。若任一 arm 失败，命令先写出可定位报告，再以 `EVAL_RUN_FAILED` 非零退出。版本审批命令：

```powershell
pnpm eval:versions
pnpm eval:approve
```

普通 `pnpm check` 只检查已审批版本并运行 mock 单测，不生成评测产物，也不调用真实 OpenAI。

审批文件分别记录 prompt、Schema 与 evaluation 三套版本和 SHA-256 指纹。对应行为指纹变化时必须先提升对应版本，`pnpm eval:approve` 才允许更新批准记录。
