# TASK_PROMPTS.md — 分阶段交给 Codex 的任务

> 使用规则：一次只发送一个任务。任务完成且验收通过后，再发送下一个。

---

## 任务 0：仓库审计与实施准备

```text
请完整阅读 AGENTS.md、PLAN.md、schemas/ 和 fixtures/。

只进行审计与准备，不实现产品功能。

需要完成：
1. 复述项目的用户问题、核心机制、MVP 范围和非目标；
2. 审查 PLAN.md 中的技术选择，指出不必要复杂度、缺失依赖和风险；
3. 确认推荐技术栈；如变更，写 docs/adr/0001-technology-stack.md；
4. 检查两个 JSON Schema 是否能够支撑 M1–M4，修正明显问题；
5. 设计最终 monorepo 目录树；
6. 把 M1 拆成可独立验证的原子任务；
7. 创建 docs/implementation-readiness.md、docs/open-questions.md、docs/status.md；
8. 不安装依赖，不编写业务代码。

输出已创建或修改的文件、关键决策和 M1 执行顺序。
除非缺少会阻断 M1 的信息，否则不要提问。
```

---

## 任务 1：M1 仓库脚手架与契约

```text
实施 PLAN.md 的 M1，禁止开始 M2。

要求：
- pnpm workspaces monorepo；
- apps/extension、apps/api 和 packages/contracts；compiler-core、openai-adapter、evals 分别到 M2、M3、M5 再创建；
- TypeScript strict；
- ESLint、Prettier、Vitest；
- 根命令 dev、build、test、lint、typecheck、format:check、check；
- contracts 包从 schemas 生成或对应实现 Zod Schema；
- 最小 CompileRequest、ReviseRequest、CompileResponse、ReviseResponse 和 ErrorResponse 契约；
- Fastify health endpoint；
- Chrome Manifest V3 空侧边栏，可在开发者模式加载；
- GitHub Actions 或等价 CI；
- .env.example；
- README 提供 Windows PowerShell 和通用 shell 的启动步骤；
- 不调用 OpenAI，不实现编译逻辑。

必须运行所有检查，并把结果写入 docs/status.md。
```

---

## 任务 2：M2 编译器纯核心

```text
实施 PLAN.md 的 M2，禁止接入真实 OpenAI。

先设计 compiler-core 的依赖接口，再实现：
- 输入标准化数据结构；
- VisualSpec 构建接口；
- 三方向规划数据结构；
- GPT Image 2 自然语言 renderer；
- 确定性 lint 规则；
- 一次修复策略；
- compileBrief 和 reviseCompilation 的纯业务编排；
- fixtures 驱动测试。

创建或更新 ADR 解释：
- 为什么 VisualSpec 与 renderer 分离；
- 硬规则与软评分如何区分；
- 三方向差异如何判断。

使用 deterministic fake planner 让测试稳定。
不得把模型逻辑写死在 UI 或 API route。
```

---

## 任务 3：M3 OpenAI 服务端集成

```text
实施 PLAN.md 的 M3。

使用官方 OpenAI TypeScript SDK和 Responses API。
模型名通过环境变量配置，不在业务代码硬编码文本模型。
图像模型默认配置为 gpt-image-2，但本里程碑不生成图片。

实现：
- openai-adapter；
- VisualSpec 和 CompileResponse 的结构化输出；
- POST /v1/compile；
- POST /v1/revise；
- 超时、有限重试、错误映射；
- 自动 repair 最多一次；
- 日志脱敏；
- CORS 来源配置；
- 请求体上限和 rate limit；
- mock 集成测试；
- 可选的真实 smoke test 脚本，默认不在 CI 运行。

确认客户端 bundle 中不存在 OPENAI_API_KEY。
```

---

## 任务 4：M4 Chrome Side Panel 主流程

```text
实施 PLAN.md 的 M4。

完成：
- 中文简报表单；
- 自动/手动任务类型；
- 比例、必须文字、必须元素、禁止元素、创意自由度；
- 高级设置折叠；
- API 调用；
- 标准化简报、假设、风险；
- 稳妥/创意/实验三个结果；
- 完整提示词和精简提示词；
- 复制、收藏、历史、清空；
- 修改指定方向；
- chrome.storage.local 数据版本迁移；
- loading、timeout、offline、rate limited、invalid output 等状态；
- 基础键盘和无障碍支持；
- Playwright E2E。

不得新增 activeTab、all_urls 或 contextMenus 权限。
```

---

## 任务 5：M5 评测与回归系统

```text
实施 PLAN.md 的 M5。

建立可重复的评测命令：
- 读取 fixtures/benchmark-cases.jsonl；
- 运行 baseline 和 compiler；
- 输出 JSON 与 Markdown 报告；
- 统计固定文字保留、禁止项、Schema 成功、冲突、方向差异和长度；
- 支持 mock 模式和显式真实模型模式；
- 记录 promptVersion、schemaVersion 和模型；
- 为 prompt 模板变化建立快照或批准流程；
- 生成 artifacts/evals/，但不提交包含敏感数据的运行结果。

不要宣称“美观提升”，除非存在人工盲测数据。
```

---

## 任务 6：M6 案例模式库实验

```text
实施 PLAN.md 的 M6，保持 ENABLE_CASE_RETRIEVAL 默认 false。

实现：
- case Schema；
- rightsStatus 和许可证 gate；
- 内容哈希和去重；
- patternSummary，而不是默认注入全文；
- 小规模本地检索；
- 检索开关和强度；
- 输出相似度检查；
- 无检索/有检索 A/B 评测报告。

只导入用户明确提供或许可证清晰的少量样例。
不得自动抓取 GitHub。
根据评测结果提出“默认开启、保持可选或移除”的建议，不要自行决定。
```

---

## 任务 7：M7 GPT Image 2 预览

```text
实施 PLAN.md 的 M7。

实现前先阅读当前官方 GPT Image 2 文档，避免依赖过时参数。

完成：
- POST /v1/generate；
- 服务端 gpt-image-2 调用；
- 支持文本生成和后续参考图扩展的接口边界；
- 合法尺寸、数量、请求体和成本保护；
- ENABLE_IMAGE_GENERATION 默认 false；
- 侧边栏预览；
- 错误与重试；
- 不默认持久化图片；
- 图片结果的最小反馈表单；
- 从失败反馈构建 revise patch；
- 测试中不调用真实付费 API。

不得自动连续生成多批图片。
```

---

## 任务 8：M8 发布加固

```text
实施 PLAN.md 的 M8。

完成：
- 安全与隐私审查；
- 案例许可证清单；
- Chrome 权限审查；
- 依赖漏洞检查；
- 日志和遥测审查；
- 性能分析；
- 构建产物检查；
- 发布包；
- 发布检查表；
- 回滚说明；
- 从干净 Windows 环境复现安装、构建和加载扩展。

输出 release-readiness 报告。
不得自行发布到 Chrome Web Store。
```

---

## 常用审查任务

### 架构审查

```text
只审查，不修改代码。根据 PLAN.md、AGENTS.md 和现有 ADR，检查当前实现是否发生：
- UI 与核心逻辑耦合；
- API Key 泄漏；
- Schema 漂移；
- 越过 MVP 范围；
- 不可测试的模型调用；
- 过度抽象；
- 未记录的架构决策。
按严重级别输出问题、证据、影响和最小修复建议。
```

### 回归审查

```text
运行全部 check 和 eval mock。
比较本分支与主分支的：
- Schema；
- promptVersion；
- lint 规则；
- 基准报告；
- 扩展权限；
- API 响应结构。
只报告可复现的回归，并提供复现命令。
```

### 安全审查

```text
只进行防御性安全审查。
重点检查：
- 客户端密钥；
- CORS；
- rate limit；
- 请求体；
- 日志敏感信息；
- 任意 URL/文件输入；
- prompt injection 对内部指令和案例数据的影响；
- 依赖风险；
- 错误信息泄漏。
不要尝试攻击外部系统。
```
