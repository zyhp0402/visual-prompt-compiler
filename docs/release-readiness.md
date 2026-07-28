# M8 发布就绪报告

更新时间：2026-07-28

## 判定

- **软件/构建候选：本地检查通过，待独立 clean-clone 复现。**
- **公开或 Chrome Web Store 发布：阻塞。**

阻塞不是构建失败：真实 OpenAI 文本/图片调用、视觉质量、人工偏好胜率、生产部署和 Chrome Web Store 政策表单尚未验证。当前 10 条 mock benchmark 也不足以证明 PLAN 的质量发布门；不得用自动规则结果豁免人工门。

## 已审查

- 权限、密钥边界、输入限制、CORS、速率限制、日志脱敏、本地存储和图片非持久化。
- 4 条发布案例均为本项目 synthetic、CC0-1.0、approved。
- 跨平台静态发布检查覆盖 manifest 权限、敏感标记、源码映射和多余源码。
- Windows 打包流程从验证后的 `dist` 生成 ZIP、SHA-256 和逐文件清单，并校验 ZIP 内容一致。

## 本轮证据

- `pnpm check` 通过：146 个 Vitest、3 个 release-check 测试、全部 strict typecheck/build、版本门禁和 2 个 unpacked-extension Playwright E2E 均通过。
- `pnpm audit --prod --json`：58 个生产依赖，五个严重级别均为 0。
- `pnpm licenses list --prod --json`：仅 MIT、BSD-3-Clause、ISC、Apache-2.0。
- Side Panel：JavaScript 293.92 kB（gzip 89.31 kB），CSS 10.14 kB（gzip 2.92 kB），HTML 0.42 kB（gzip 0.31 kB）；M8 未增加运行时代码。
- Windows 候选包：`visual-prompt-compiler-0.1.0.zip`，92,033 bytes，SHA-256 `a62cd5ecd3d71a4ba5842d7cd531332764ffc5eed1c6737ecb32feddc66d033b`，4 个文件。
- 独立 clean-clone 的 Node 24/pnpm 11 frozen install、完整检查、打包与 unpacked-extension E2E 仍待记录。

## 发布门

| 门                                | 当前状态                 |
| --------------------------------- | ------------------------ |
| 无 P0/P1 软件安全问题             | 通过（静态与 mock 范围） |
| 可从干净 Windows 环境复现         | 待独立 clean-clone 证据  |
| 关键 E2E                          | 通过：2/2                |
| 依赖漏洞                          | 通过：0 个已知漏洞       |
| 真实 OpenAI 行为与账户权限        | 阻塞                     |
| 固定 20 任务图片 A/B 与人工偏好门 | 阻塞                     |
| Chrome Web Store 政策/隐私表单    | 阻塞                     |

没有任何发布门被静默豁免。只有具备发布权限的负责人可以书面接受剩余风险；M8 不执行商店发布。

## Chrome Web Store 政策依据

- [隐私政策](https://developer.chrome.com/docs/webstore/program-policies/privacy)
- [最小权限与单一用途政策](https://developer.chrome.com/docs/webstore/program-policies/policies)
- [数据处理披露要求](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements)
- [发布流程](https://developer.chrome.com/docs/webstore/publish)
