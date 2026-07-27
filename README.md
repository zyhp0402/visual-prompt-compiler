# Visual Prompt Compiler

Chrome Manifest V3 Side Panel + Fastify 的 pnpm monorepo。当前完成 M4：中文侧边栏通过服务端 compile/revise API 生成三份方向，并在 `chrome.storage.local` 保存历史与收藏。

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
- `pnpm check`：依次执行全部检查、构建和 E2E。

## 环境变量

复制 `.env.example` 后仅在服务端环境填写 `OPENAI_API_KEY`、`OPENAI_TEXT_MODEL` 和允许的扩展来源。`VITE_API_BASE_URL` 只包含 API 地址；密钥不得进入扩展 bundle 或 `chrome.storage.local`。

真实 OpenAI smoke test 默认禁用。先启动 API，再显式执行：

```powershell
$env:RUN_OPENAI_SMOKE='1'
node scripts/smoke-openai.mjs
```

CI 只运行 mock，不执行该脚本。
