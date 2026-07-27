# Visual Prompt Compiler

Chrome Manifest V3 Side Panel + Fastify 的 pnpm monorepo。当前完成 M2：除 M1 的契约、health endpoint 和可加载空侧边栏外，包含可独立测试的纯 `compiler-core`、确定性 fake planner、renderer、lint 与最多一次 repair；尚未接入 OpenAI。

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

Chrome/Chromium 中加载 `apps/extension/dist`。

## 根命令

- `pnpm dev`：并行启动 API 和扩展 Vite 开发服务；
- `pnpm build`：构建全部 workspace；
- `pnpm test`：运行 Vitest；
- `pnpm lint`：运行 ESLint；
- `pnpm typecheck`：运行 TypeScript strict 检查；
- `pnpm format:check`：检查格式；
- `pnpm test:e2e`：真实加载构建后的 unpacked extension；
- `pnpm check`：依次执行全部检查、构建和 E2E。

## 环境变量

复制 `.env.example` 后仅在服务端环境填写。M2 不需要任何 OpenAI 凭据，且扩展 bundle 不应包含 `OPENAI_API_KEY`。
