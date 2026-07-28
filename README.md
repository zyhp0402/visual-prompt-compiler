# Visual Prompt Compiler

Chrome Manifest V3 Side Panel + Fastify 的 pnpm monorepo。当前实现 M7：在默认关闭的服务端开关后提供 GPT Image 2 单图低质量预览和显式图片反馈闭环。

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
- `pnpm eval:cases:mock`：比较关闭/开启案例检索的离线 compiler A/B；
- `pnpm eval:real`：显式运行真实双臂基准；
- `pnpm eval:versions`：检查 prompt/schema 版本审批记录；
- `pnpm eval:approve`：显式更新版本审批记录；
- `pnpm check`：依次执行全部检查、构建和 E2E。

## 环境变量

复制 `.env.example` 后仅在服务端环境填写 `OPENAI_API_KEY`、`OPENAI_TEXT_MODEL`、`OPENAI_IMAGE_MODEL` 和允许的扩展来源。`VITE_API_BASE_URL` 只包含 API 地址；密钥不得进入扩展 bundle 或 `chrome.storage.local`。图片预览默认关闭：

```dotenv
OPENAI_IMAGE_MODEL=gpt-image-2
ENABLE_IMAGE_GENERATION=false
```

只有完成组织/项目验证、额度与费用确认后，才在服务端显式设置 `ENABLE_IMAGE_GENERATION=true`。扩展不保存 API Key。

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

## 案例模式实验

`fixtures/case-patterns.jsonl` 只包含 4 条本项目自写、`CC0-1.0`、`rightsStatus: approved` 的 synthetic pattern。规范化内容哈希使用固定字段顺序和 NFKC，覆盖设计内容、来源、许可证、署名及权利状态，仅排除 ID、哈希本身和导入时间；`pending`、`rejected`、`NOASSERTION`、哈希错误和重复内容不会进入检索。

检索使用本地确定性中文 3-gram 重合与任务类型优先排序，不联网、不抓取 GitHub、不依赖数据库或向量库。强度规则固定为：

- `low`：最多 1 条，跨类型重合阈值 0.18；
- `medium`：最多 2 条，跨类型重合阈值 0.10；
- `high`：最多 3 条，跨类型重合阈值 0.05。

planner 仅接收 `id`、`license` 和 `patternSummary`；案例原始结构、来源正文和用户简报不写入评测报告。输出与 `patternSummary` 的单段相似度取字符 3-gram Jaccard 和 pattern-gram containment 的较大值，使原样嵌入长 prompt 的摘要得分为 1；再按三个方向分别聚合 full/compact 最大值。固定阈值仍为 0.72，只报告不自动重写。

```powershell
pnpm eval:cases:mock -- --run-id local-cases --now 2026-07-28T00:00:00.000Z
```

当前 10 条 benchmark 少于 Gate A 要求的 100 条，且没有人工偏好数据；mock 硬指标无提升，并有 18/30 个方向因原样注入摘要而触发相似度标记。因此实验建议为 `remove`，但这只是一项证据结论，不会自动删除实验代码、改写输出或启用产品功能；`ENABLE_CASE_RETRIEVAL=false` 不变，API 与 Side Panel 尚未接入实验检索。

## GPT Image 2 单图预览

`POST /v1/generate` 使用独立 `image-1` 契约。请求固定为文本 source、`n=1`、`quality=low`、`outputFormat=png`，尺寸只允许 `1024x1024`、`1536x1024`、`1024x1536`。服务端使用 `gpt-image-2` 的 `images.generate`，SDK `maxRetries=0`；失败后只有用户再次点击“手动重试生成”才会发起下一次调用。

每个方向的入口都会提示一次付费图片调用。返回的 PNG base64 只存在于当前 React 页面内存，不写入历史、收藏或 `chrome.storage.local`，刷新即消失。图片失败反馈只生成保留硬约束的 revise instruction，并填入现有修改表单；用户必须显式点击“提交修改”，系统不会自动 revise 或连续生成第二批图片。

参考图未来进入 Images edits 边界。本轮不增加上传、参考图持久化或扩展权限。单元、集成和 E2E 均使用 mock，不调用真实 Images API。
