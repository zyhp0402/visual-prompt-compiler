# M8 发布就绪报告

更新时间：2026-07-28

## 判定

- **软件/构建候选：通过。**
- **公开或 Chrome Web Store 发布：阻塞。**

阻塞不是构建失败：真实 OpenAI 文本/图片调用、视觉质量、人工偏好胜率、生产部署和 Chrome Web Store 政策表单尚未验证。当前 10 条 mock benchmark 也不足以证明 PLAN 的质量发布门；不得用自动规则结果豁免人工门。

商店提交还缺少公开隐私政策 URL、商店图标/截图、Developer Dashboard 数据使用披露、公开 Limited Use 合规声明，以及在发送简报前说明数据会进入所配置 API/OpenAI 项目的产品内显著披露和明确、知情、主动同意。当前 manifest 只允许 HTTP localhost/127.0.0.1，因此本候选包是本地运行边界，不是生产域名版本。

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
- Windows 候选包：`visual-prompt-compiler-0.1.0.zip`，92,033 bytes，当前工作区 SHA-256 `a62cd5ecd3d71a4ba5842d7cd531332764ffc5eed1c6737ecb32feddc66d033b`，4 个文件。
- 同一 Windows 宿主上的独立 clean clone `ea030cd84aeb4a8bce8109d9049530216969cadc`：空工作目录、无 `node_modules`/`dist`，Node 24.14.0 / pnpm 11.9.0 frozen install、完整 `pnpm check`、2/2 unpacked-extension E2E 和 Windows 打包均通过。没有使用全新 OS/VM 或空 pnpm 全局 store，结论不扩大到该范围。
- clean clone 的逐文件 SHA-256 清单与当前工作区完全一致；ZIP SHA-256 为 `064aee006aef01d8574d74be4d51e003fb15c7c53f77c2fb0e18287182c1f0ad`。`Compress-Archive` 保留文件时间元数据，因此 ZIP 总哈希只标识当次产物，不承诺跨目录 byte-for-byte 一致。

## 发布门

| 门                                | 当前状态                 |
| --------------------------------- | ------------------------ |
| 无 P0/P1 软件安全问题             | 通过（静态与 mock 范围） |
| 同一 Windows 宿主的 clean clone   | 通过                     |
| 关键 E2E                          | 通过：2/2                |
| 依赖漏洞                          | 通过：0 个已知漏洞       |
| 真实 OpenAI 行为与账户权限        | 阻塞                     |
| 固定 20 任务图片 A/B 与人工偏好门 | 阻塞                     |
| Chrome Web Store 政策/隐私表单    | 阻塞                     |

没有任何发布门被静默豁免。只有具备发布权限的负责人可以书面接受剩余风险；M8 不执行商店发布。

独立对抗审查、验证审查和 Ponytail 复杂度审查提出的 manifest 能力、`.env*`、性能边界、clean-clone 措辞、回滚重启和隐私披露问题均已修正；最终无剩余 P0/P1。

## 性能分析

- 静态产物为 JavaScript 293.92 kB（gzip 89.31 kB）、CSS 10.14 kB（gzip 2.92 kB）和 HTML 0.42 kB（gzip 0.31 kB）。
- M8 对 `apps/extension/src` 的运行时代码改动为 0，因此没有引入可归因于 M8 的 bundle 或前端运行时回归。
- 未发现需要在 M8 优化的本地热点；为没有证据的瓶颈加缓存、拆包或并发机制会增加复杂度。
- 未调用真实 OpenAI，故没有文本/图片 API 的 P50/P95、首结果时间或超时率。现有 Playwright 用例含人为延时，只用于行为验收，不作为性能基准。生产发布前必须在批准的项目、网络和固定样本上另行测量。

## Chrome Web Store 政策依据

- [隐私政策](https://developer.chrome.com/docs/webstore/program-policies/privacy)
- [最小权限与单一用途政策](https://developer.chrome.com/docs/webstore/program-policies/policies)
- [数据处理披露要求](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements)
- [用户数据 FAQ 与 Limited Use 要求](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
- [发布流程](https://developer.chrome.com/docs/webstore/publish)
