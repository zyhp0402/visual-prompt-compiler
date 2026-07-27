# ADR 0005：扩展本地状态与 API 边界

- 状态：接受
- 日期：2026-07-27

## 背景

M4 需要让无账号 Chrome Side Panel 保存设置、最近历史和收藏，并从本地 Fastify API 获取 compile/revise 结果。扩展不能保存 API Key，也不能把未经校验的服务端数据写入 UI 或本地历史。跨域请求必须声明 host permissions，但开发期只需要访问本机 API。

## 决策

- 扩展只使用一个 `chrome.storage.local` 键 `vpcState`，对象包含 `version=2`、设置、最多 20 条历史、最多 50 条收藏和最小 UI 展开状态。
- 历史条目只保存经 contracts 校验的结果、时间、结果派生标签和任务类型，不保存原始 `CompileRequest` 或 `brief`。v1/无版本旧数据迁移到 v2 时显式丢弃 `request`；未知版本或损坏数据回退为空 v2。
- 收藏保存用户明确选择的单个方向，不保存 API Key。历史回放和后续 revise 直接使用结果内的 `normalizedBrief` 与三方向，不依赖原始输入。
- storage hydration 与所有设置、历史、收藏和清空写入经过同一个串行 functional update 队列；每次 transform 都基于最新持久化状态，避免延迟 load 或异步请求完成时覆盖并发设置或收藏。
- hydration 发现 v1、无版本、损坏或其他非规范数据时，先把 sanitized v2 物理回写到 `chrome.storage.local` 再返回，确保旧 `request.brief` 不只是在内存中隐藏。
- API 基址由根目录环境变量 `VITE_API_BASE_URL` 注入，默认 `http://127.0.0.1:8787`。扩展只新增 `http://127.0.0.1/*` 与 `http://localhost/*` 两个精确 host permissions。
- API 客户端在展示和持久化前使用共享 `CompileResponseSchema`、`ReviseResponseSchema` 和 `ErrorResponseSchema` 校验；超时、离线、限流、非法输出、上游错误和请求错误映射为稳定 UI 状态。
- revise 发送当前结果的完整 `previousSpec` 和三方向 `previousDirections`；指定方向时设置 `preserveOtherDirections=true`。
- UI 使用递增 operation id，只允许最新 compile/revise 提交结果；新 compile 立即移除旧结果，reset 和历史恢复会使旧异步操作失效。
- 清空历史/收藏不取消在途 compile/revise，也不清除 busy；历史使用独立 generation，清空前启动的请求仍可展示结果，但不会把旧记录重新写回已清空历史。
- compile/revise 成功及历史恢复通过 `aria-live` 播报，并在 React 提交后把焦点移动到结果区域；清空前先把焦点移到稳定的列表标题。

## 后果

- M4 不需要数据库、登录、状态库或新的服务端持久化。
- 存储损坏不会阻止扩展启动，但无法恢复的旧数据会被安全忽略；v1 原始请求在迁移后不可恢复。
- 异步 API 与本地写入存在明确提交顺序，不会把已失效结果回灌 UI，也不会用旧 React 闭包覆盖较新的持久化状态。
- 更换 API 地址需要重新构建扩展；未来若需要用户可编辑的任意远端地址，必须重新评审 host permissions，不能静默扩大到 `<all_urls>`。
- 加载扩展后，开发者必须把实际 `chrome-extension://<id>` 加入 API 的 `ALLOWED_EXTENSION_ORIGINS`。
