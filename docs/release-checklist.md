# 发布检查表

## 构建候选包

- [ ] 使用 Node 24.14.x、pnpm 11.9.0 和 frozen lockfile。
- [ ] `pnpm check` 全绿。
- [ ] `pnpm audit --prod` 已复核且无未处置的 high/critical。
- [ ] `pnpm release:package:windows` 成功。
- [ ] `.sha256` 与 ZIP 的 `Get-FileHash -Algorithm SHA256` 一致。
- [ ] `.files.txt` 与 ZIP 内容一致；无 source map、源码、`.env`、密钥或多余权限。
- [ ] 在干净 Windows clone 中加载 unpacked extension 并跑现有 Playwright E2E。

## 部署与政策

- [ ] 生产 API 使用 HTTPS，CORS 只允许最终扩展 ID。
- [ ] Key、模型、限流、超时、预算和日志保留期已由部署者批准。
- [ ] 隐私说明与 Chrome Web Store Data usage 表单逐项一致。
- [ ] 商店文案不承诺“保证美观”，截图不含真实用户数据。
- [ ] 真实 OpenAI smoke、固定 20 任务图片 A/B 和人工偏好门已完成。
- [ ] 无 P0/P1；其余风险已有具名接受者和回滚触发条件。

任何未勾选项必须在发布记录中标为“阻塞”或由有权限的负责人书面豁免；本仓库不会自行创建豁免或发布到 Chrome Web Store。
