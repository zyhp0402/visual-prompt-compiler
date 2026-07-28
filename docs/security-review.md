# M8 安全审查

审查日期：2026-07-28

## 结论

静态审查未发现 P0/P1。软件候选包保留最小权限和既有服务端边界；真实部署仍必须完成凭据、CORS、额度和日志保留配置。

| 范围         | 结果 | 证据                                                                                                |
| ------------ | ---- | --------------------------------------------------------------------------------------------------- |
| Chrome 权限  | 通过 | 仅 `sidePanel`、`storage`；host 仅 localhost 与 127.0.0.1；无 `<all_urls>`                          |
| 密钥         | 通过 | Key 只由 API 环境变量读取；发布检查拒绝 `OPENAI_API_KEY` 和 `sk-...`                                |
| 请求边界     | 通过 | Zod、body limit、CORS allowlist、rate limit、timeout；图片默认关闭且固定单图                        |
| 日志/遥测    | 通过 | Fastify 默认请求日志关闭；allowlist 日志不含 brief、prompt、固定文案、错误对象或 base64；无分析 SDK |
| 本地数据     | 通过 | 有容量上限和清空入口；迁移移除旧版原始 request/brief；图片不持久化                                  |
| 案例权利     | 通过 | 4 条 synthetic CC0-1.0 approved；权利和哈希 gate                                                    |
| 构建产物     | 通过 | 自动拒绝源码映射、TS/TSX/JSX、密钥标记和额外权限                                                    |
| 依赖漏洞     | 通过 | 58 个生产依赖，info/low/moderate/high/critical 均为 0                                               |
| 生产依赖许可 | 通过 | `pnpm licenses list --prod --json` 仅报告 MIT、BSD-3-Clause、ISC、Apache-2.0                        |

## 运维前置条件

- 生产环境必须配置 HTTPS、精确的扩展 origin、服务端 secret 管理、请求额度和日志保留期。
- `ENABLE_IMAGE_GENERATION` 保持 `false`，直到组织验证、项目额度和成本告警完成。
- 仓库没有身份认证；API 不得直接暴露为不受控的公网付费代理。
