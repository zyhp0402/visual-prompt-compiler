# 回滚说明

## 立即止损

1. 设置服务端 `ENABLE_IMAGE_GENERATION=false` 后重启或重新部署服务，并确认 `/v1/generate` 返回 503，停止新的图片费用。
2. 如文本链路异常，撤下 API 流量或回滚到最后一个已验证服务端提交。
3. 吊销疑似泄漏的 Key，并检查脱敏日志中的 request ID、错误码和时间窗口；不要复制用户正文。

## 扩展回滚

Chrome Web Store 不能用更低版本覆盖已发布版本。以最后一个已验证提交重新构建，给 manifest 设置一个更高的修复版本，重新执行发布检查和人工审核后提交。不要修改旧 ZIP；保留其 SHA-256、文件清单、提交号和 CI 证据。

## 验证

- 重跑 `pnpm check` 和 `pnpm release:package:windows`。
- 核对 ZIP SHA-256，在干净环境加载并验证 compile、revise、历史清空和图片开关关闭。
- 记录故障范围、触发时间、回滚版本和恢复验证；只有根因已修复且门禁重过后才重新启用功能。
