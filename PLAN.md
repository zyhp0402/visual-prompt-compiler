# PLAN.md — Visual Prompt Compiler

## 0. 文档目的

本文件是 Visual Prompt Compiler 的产品需求文档、系统设计草案、实施路线和验收标准。Codex 必须按里程碑执行，不得一次性实现全部内容。

---

# 1. 第一性原理审查

## 1.1 用户真正要完成的工作

用户表面需求是“自动生成任意风格的 GPT Image 2 提示词”，更底层的实际任务是：

> 将不完整、非专业、含混的视觉意图，转换成模型可以执行、用户可以理解、可持续修改的视觉规格，从而更高概率地产生符合预期的图片。

因此，产品的核心产物不是一段长文本，而是一个可检查、可变换、可追踪的 **视觉意图中间表示**。

## 1.2 系统能控制什么

系统可以直接控制：

- 是否完整识别用户的硬约束；
- 是否区分事实、要求、假设和自由发挥；
- 是否明确主体、空间关系、视觉层级和元素数量；
- 是否避免构图、镜头、光线、材质和文字要求互相冲突；
- 是否根据任务类型选用合适的描述字段；
- 是否让三个方向产生结构差异，而不只是替换形容词；
- 是否保留指定文字且不擅自改写；
- 是否对禁止内容做显式检查；
- 是否让输出满足稳定的 JSON 契约；
- 是否通过基准数据和用户反馈持续评估。

## 1.3 系统不能保证什么

系统不能绝对保证：

- 每次生成都“美观”；
- 所有用户对美感达成一致；
- 图像模型每次都严格复现复杂文字；
- 同一提示词每次生成完全相同结果；
- 模型升级后行为完全不变；
- 从优秀案例提取的规律一定适用于新主题。

产品文案、测试与 UI 都不得使用“保证美观”“必出神图”等承诺。

## 1.4 对原方案的关键修正

### 修正 A：案例库不是产品核心

原方案把“学习优秀案例”放得过重。案例只能提供证据和启发，不能成为唯一生成机制。

原因：

1. 用户需求可能没有近似案例；
2. 相似案例会诱导抄袭式输出；
3. 大量案例质量和许可证不稳定；
4. 召回错误会比无检索更差；
5. 提示词是否优秀不能只由其文字判断，还依赖实际生成结果。

**决定：** MVP 先完成无案例也能工作的编译器；案例检索作为可关闭的增强模块，在离线评测证明有效后再进入默认链路。

### 修正 B：八维字段不是固定模板

“主体、构图、镜头、光线、色彩、材质、风格、背景”适合大量场景，但不适用于所有任务。

例如：

- UI 截图需要组件层级、状态和交互密度；
- 信息图需要数据、图表类型和阅读顺序；
- Logo 需要形状语法、缩放适应性和单色表现；
- 图片编辑需要保持项、修改项和遮罩边界；
- 连续分镜需要角色一致性、时间连续性和镜头变化。

**决定：** 使用公共基础字段 + 任务类型扩展，而不是强迫所有任务填满固定八维。

### 修正 C：先生成 VisualSpec，再渲染提示词

直接从用户输入生成最终提示词，难以验证遗漏和冲突。

**决定：** 使用两阶段编译：

```text
RawBrief → VisualSpec → RenderPrompt
```

`VisualSpec` 是稳定 JSON；最终提示词只是针对某个图像模型的渲染结果。未来更换模型时只替换 renderer。

### 修正 D：“三种方向”必须结构不同

稳妥、创意、实验不能只是修改配色或风格词。

- 稳妥：最大化需求忠实度，降低假设数量；
- 创意：保留目标与硬约束，改变视觉叙事、构图或媒介；
- 实验：允许跨媒介和非典型空间，但不得破坏品牌、文字和禁止项。

每个方向要记录其“设计差异轴”。

### 修正 E：先评测，再扩张

没有基准集时无法知道元提示词、案例检索或模型升级是否真正改善。

**决定：** M0 就建立基准集、规则评分和人工偏好记录格式。评测不是发布前补做，而是系统核心。

### 修正 F：美学判断采用分层证据

提示词文本只能判断“美学可执行性”，不能证明最终图片美观。

质量分三层：

1. **静态规则层**：字段、冲突、禁用项、文字保真；
2. **模型审查层**：连贯性、可执行性、差异性、原创风险；
3. **图片反馈层**：实际预览图的构图、文字、主体和偏好结果。

MVP 完成前两层；第三层进入 V1。

---

# 2. 产品定义

## 2.1 产品名称

工作名：`Visual Prompt Compiler`

中文名：`视觉提示词编译器`

## 2.2 目标用户

首版聚焦：

- 经常使用 GPT Image 2 生成海报、展厅画面、产品概念图、摄影场景和 3D 场景的内容与设计人员；
- 能描述业务内容，但不一定熟悉摄影、视觉设计或提示词工程的用户；
- 需要重复修改、保存、复用提示词的个人用户。

## 2.3 核心价值主张

输入一句自然语言简报，系统输出：

1. 标准化需求摘要；
2. 识别出的硬约束；
3. 系统补充的显式假设；
4. 三个真正不同的视觉方向；
5. 每个方向对应的 GPT Image 2 完整提示词；
6. 自动检查结果和风险；
7. 可复制、收藏、再次改写的结果。

## 2.4 北极星指标

**首次可用率 First Usable Prompt Rate**

定义：用户第一次编译后，未重新编译即可复制或收藏至少一个方向的会话占比。

辅助指标：

- 硬约束保留率；
- 禁止内容违规率；
- 三方向差异合格率；
- 用户复制率；
- 用户收藏率；
- 首次生成后再次重写率；
- 与基础单轮提示相比的人工偏好胜率；
- P50/P95 延迟；
- 单次编译估算成本；
- 输出解析失败率；
- 案例相似度泄漏率。

---

# 3. MVP 范围

## 3.1 必须实现

### 输入

- 原始需求文本；
- 比例选择：自动、1:1、4:3、3:4、16:9、9:16、自定义；
- 交付物类型：自动判断或手动选择；
- 必须出现的文字；
- 必须出现的元素；
- 禁止出现的元素；
- 创意自由度；
- 输出语言；
- “允许系统补全细节”开关。

### 输出

- 标准化简报；
- 假设清单；
- 风险与未解决问题；
- 稳妥、创意、实验三个方向；
- 每个方向的概念、差异轴、完整提示词、精简提示词、禁止内容和质量分；
- 复制；
- 收藏；
- 基于用户一句修改意见重新编译；
- 本地历史。

### 系统能力

- VisualSpec Schema；
- 任务分类器；
- 需求标准化；
- 三方向规划；
- 提示词渲染；
- 确定性规则检查；
- 一次自动修复；
- Responses API 结构化输出；
- 服务端密钥；
- 基准测试；
- 错误、超时和重试。

## 3.2 明确不做

见 `AGENTS.md` 的范围纪律。尤其不做：

- 海量抓取；
- 训练；
- 用户系统；
- 支付；
- 社区；
- 自动控制 ChatGPT 页面；
- 默认保存原始用户数据；
- “艺术家风格模仿”快捷功能。

---

# 4. 核心用户流程

## 4.1 首次编译

```text
打开侧边栏
→ 输入简报和约束
→ 点击“编译提示词”
→ 本地校验
→ API 生成 VisualSpec
→ 确定性规则检查
→ 如有可修复问题，执行一次修复
→ 返回三个方向
→ 用户复制、收藏或提出修改
```

## 4.2 修改结果

用户输入：

> 保持主体和构图，改成更明亮的蓝白企业展厅风格，删除人物。

系统必须：

- 将修改解析为 patch；
- 保留未被修改的硬约束；
- 更新 VisualSpec；
- 重新渲染三个方向或指定方向；
- 显示本次改变了什么；
- 不把完整历史无限追加到提示词。

## 4.3 信息不足

不默认阻断用户。

系统应：

1. 标记缺失字段；
2. 在用户允许补全时做显式假设；
3. 对影响较大的缺失项显示风险；
4. 仍生成可用结果；
5. 只有在缺少关键事实会导致错误结果时，才返回 `needs_input=true`。

---

# 5. 系统架构

## 5.1 总体架构

```text
Chrome Extension
  ├─ Side Panel UI
  ├─ Form validation
  ├─ Local history/favorites
  └─ API client
          │ HTTPS
          ▼
Fastify API
  ├─ Auth-free MVP request guard
  ├─ Rate limit / CORS / timeout
  ├─ Compile controller
  └─ OpenAI adapter
          │
          ▼
Prompt Compiler Core
  ├─ Brief normalizer
  ├─ Task classifier
  ├─ VisualSpec planner
  ├─ Variant planner
  ├─ Deterministic linter
  ├─ Repair orchestrator
  ├─ GPT Image 2 renderer
  └─ Telemetry sanitizer
```

## 5.2 Monorepo 目录

```text
/
├─ apps/
│  ├─ extension/
│  │  ├─ src/
│  │  │  ├─ components/
│  │  │  ├─ features/brief/
│  │  │  ├─ features/results/
│  │  │  ├─ features/history/
│  │  │  ├─ lib/api/
│  │  │  ├─ lib/storage/
│  │  │  └─ sidepanel/
│  │  ├─ manifest.json
│  │  └─ tests/
│  └─ api/
│     ├─ src/
│     │  ├─ routes/
│     │  ├─ plugins/
│     │  ├─ config/
│     │  └─ server.ts
│     └─ tests/
├─ packages/
│  ├─ contracts/
│  ├─ compiler-core/
│  ├─ openai-adapter/
│  └─ evals/
├─ schemas/
├─ fixtures/
├─ docs/
│  ├─ adr/
│  ├─ product/
│  ├─ implementation-readiness.md
│  ├─ open-questions.md
│  └─ status.md
├─ scripts/
├─ AGENTS.md
├─ PLAN.md
└─ TASK_PROMPTS.md
```

## 5.3 模块边界

### `contracts`

包含：

- Zod 输入输出 Schema；
- API DTO；
- 错误码；
- `VisualSpec` 类型；
- `CompileResult` 类型。

不得依赖 UI、Fastify 或 OpenAI SDK。

### `compiler-core`

纯业务编排：

```ts
compileBrief(input, dependencies): Promise<CompileResult>
reviseCompilation(previous, instruction, dependencies): Promise<CompileResult>
```

依赖接口而不是具体 SDK。

同时包含版本化提示词、renderer 和确定性 lint 规则。它们目前只有编译器一个消费者，不拆成独立 workspace；出现第二个独立消费者或独立发布需求时再评估拆包。

### `openai-adapter`

负责：

- Responses API 调用；
- 结构化输出；
- 超时；
- 重试；
- 模型名配置；
- 错误归一化；
- usage 元数据；
- 不记录敏感正文。

`compiler-core` 内的确定性检查包括：

- 必须文字是否原样保留；
- 必须元素是否存在；
- 禁止项是否出现在正向指令；
- 比例是否合法；
- 元素数量是否超出显式限制；
- 方向差异是否不足；
- 重复空泛形容词；
- 光线冲突；
- 镜头冲突；
- 风格冲突；
- 编辑任务是否明确“保持项”；
- 是否出现用户未要求的艺术家姓名；
- 是否泄漏案例原文。

`compiler-core` 内保存版本化的：

- 元提示词；
- 分类提示词；
- VisualSpec 规划提示词；
- 方向生成提示词；
- 修复提示词；
- renderer；
- critic rubric。

每次改变行为都提升 `promptVersion`。

---

# 6. VisualSpec 中间表示

## 6.1 公共字段

- `schemaVersion`
- `taskType`
- `goal`
- `audience`
- `deliverable`
- `aspectRatio`
- `outputLanguage`
- `mandatoryText`
- `mandatoryElements`
- `forbiddenElements`
- `subject`
- `sceneGraph`
- `visualHierarchy`
- `composition`
- `camera`
- `lighting`
- `palette`
- `materials`
- `background`
- `styleDNA`
- `typography`
- `qualityRequirements`
- `assumptions`
- `unresolvedQuestions`
- `riskFlags`

## 6.2 任务类型扩展

首版任务类型：

- `poster`
- `photography`
- `product_concept`
- `three_d_scene`
- `infographic`
- `character_design`
- `image_edit`
- `storyboard`
- `general`

扩展字段举例：

### 海报

- 信息层级；
- 标题位置；
- 正文字数；
- 阅读顺序；
- 安全边距。

### 图片编辑

- 输入图片角色；
- 必须保持；
- 必须修改；
- 允许重绘范围；
- 身份与构图一致性。

### 分镜

- 帧数量；
- 连续性锚点；
- 镜头变化；
- 时间变化；
- 角色一致性。

## 6.3 中间表示原则

- 不使用“高级、震撼、精美”等不可执行词作为唯一描述；
- 所有位置尽量使用画面关系表达；
- 每个方向只有一个第一视觉焦点；
- 假设与用户要求分开；
- 原始输入不得被模型静默改写；
- 固定文字逐字保存；
- `VisualSpec` 不应包含特定模型语法；
- renderer 再将其翻译为 GPT Image 2 友好的自然语言。

---

# 7. 编译管线

## 7.1 Stage 1：输入校验

确定性完成：

- 字符长度；
- 比例；
- 重复字段；
- 自相矛盾的显式要求；
- 空输入；
- 文字数量和总长度；
- 禁止项格式。

## 7.2 Stage 2：需求标准化

模型输出：

- 任务类型；
- 目标；
- 硬约束；
- 软偏好；
- 缺失信息；
- 可补全假设；
- 风险。

不得生成最终提示词。

## 7.3 Stage 3：VisualSpec 规划

生成基础规格及三套方向差异轴。

方向差异至少覆盖下列之一：

- 构图结构；
- 视觉叙事；
- 媒介；
- 空间组织；
- 镜头策略；
- 材料系统；
- 图形语言。

只改变色彩或形容词不算合格差异。

## 7.4 Stage 4：确定性检查

先运行规则，不合格则：

- 可机械修复：直接修复；
- 需模型修复：构造最小 repair 请求；
- 重大冲突：保留结果但添加风险，或 `needs_input=true`。

最多自动修复一次，避免无限循环。

## 7.5 Stage 5：Prompt Renderer

每个方向输出：

- `concept`
- `differenceAxes`
- `fullPrompt`
- `compactPrompt`
- `negativeConstraints`
- `assumptions`
- `riskFlags`
- `score`
- `promptVersion`

完整提示词结构由任务类型决定，不强制所有标签出现。

## 7.6 Stage 6：质量审查

文本层评分：

- 需求忠实度；
- 主体清晰度；
- 空间与构图；
- 视觉层级；
- 光线一致性；
- 色彩与材质；
- 文字可执行性；
- 禁止项控制；
- 方向差异；
- 原创风险；
- 冗余度。

评分只能辅助，不作为“美观证明”。

---

# 8. 案例检索设计（MVP 后启用）

## 8.1 进入条件

只有满足下列条件才启用：

1. 无检索基线已稳定；
2. 已有至少 100 个基准输入；
3. 案例来源、许可和去重完成；
4. A/B 评测证明案例检索提升偏好胜率或硬约束表现；
5. 近似复制率未显著上升。

## 8.2 数据策略

不要默认把 GitHub 原始提示词全文塞入模型。

优先保存：

- 任务类型；
- 设计目标；
- 视觉结构；
- 设计规律；
- 成功原因；
- 失败风险；
- 适用条件；
- 来源；
- 许可证；
- 内容哈希。

可选保存原始提示词，但检索上下文优先提供抽象后的 `patternSummary`。

## 8.3 召回策略

候选集合建议包含：

- 语义高度相关模式；
- 同交付物、不同主题模式；
- 相邻媒介模式；
- 一个有控制的远距离创意模式。

检索强度由用户控制。

## 8.4 原创保护

- 对输出和案例做 n-gram/embedding 相似度检查；
- 达到阈值则重写；
- 输出不得冒充原作者；
- UI 显示案例启发来源和许可证；
- 无权利状态不得发布。

---

# 9. API 契约

## 9.1 `POST /v1/compile`

请求：

```json
{
  "brief": "生成一张智慧交通企业展厅大屏",
  "taskType": "auto",
  "aspectRatio": "16:9",
  "mandatoryText": [],
  "mandatoryElements": [],
  "forbiddenElements": ["人物", "普通电脑屏幕"],
  "creativity": 65,
  "allowAssumptions": true,
  "outputLanguage": "zh-CN"
}
```

响应：

```json
{
  "requestId": "uuid",
  "schemaVersion": "1.0.0",
  "promptVersion": "prompt-1",
  "normalizedBrief": {},
  "needsInput": false,
  "assumptions": [],
  "riskFlags": [],
  "directions": [],
  "usage": {
    "model": "configured-model",
    "latencyMs": 0
  }
}
```

## 9.2 `POST /v1/revise`

请求必须包含：

- 上次结果的稳定 ID 或完整 VisualSpec；
- 用户修改指令；
- 要修改的方向；
- 是否保持其他方向。

服务端不得信任客户端发送的任意历史正文，必须重新校验 Schema 和大小。

## 9.3 `POST /v1/generate`（V1）

可选调用 GPT Image 2。

必须：

- 由服务端调用；
- 限制尺寸和数量；
- 返回生成元数据；
- 明确费用提示；
- 不默认永久保存图片；
- 支持取消或超时；
- 完成组织验证和相关账户配置后才能启用。

## 9.4 错误码

至少包含：

- `INVALID_REQUEST`
- `CONFLICTING_CONSTRAINTS`
- `MODEL_OUTPUT_INVALID`
- `MODEL_TIMEOUT`
- `RATE_LIMITED`
- `UPSTREAM_ERROR`
- `CONTENT_REJECTED`
- `PAYLOAD_TOO_LARGE`
- `SERVICE_UNAVAILABLE`

---

# 10. 浏览器扩展设计

## 10.1 页面结构

### 顶部

- 产品名；
- 新建；
- 历史；
- 设置。

### 简报区域

- 主输入框；
- 比例；
- 类型；
- 必须文字；
- 必须元素；
- 禁止元素；
- 创意滑块；
- 高级设置折叠；
- 编译按钮。

### 结果区域

- 标准化需求；
- 假设与风险；
- 三方向标签页或纵向卡片；
- 概念；
- 差异轴；
- 提示词；
- 分数详情；
- 复制；
- 收藏；
- 只改这个方向；
- 修改输入框。

## 10.2 本地数据

保存在 `chrome.storage.local`：

- 设置；
- 最近历史；
- 收藏；
- 展开的 UI 状态；
- 不含 API Key；
- 不默认保存参考图二进制。

必须实现版本迁移和最大历史数量。

## 10.3 权限

MVP 只申请：

- `sidePanel`
- `storage`

在确实实现右键提取页面文字时，再增加：

- `contextMenus`
- `activeTab`

不申请 `<all_urls>`。

---

# 11. 安全、隐私与合规

## 11.1 密钥

- `OPENAI_API_KEY` 只在 API 服务端；
- `.env` 不提交；
- 提供 `.env.example`；
- CI 使用 secret；
- 浏览器只请求自己的后端。

## 11.2 数据

- 默认无账号；
- 默认不持久化服务端原始输入；
- 仅保留匿名运行指标；
- 用户可清空本地历史；
- 参考图功能上线前增加隐私说明；
- 日志禁止包含完整提示词、固定文案和图片。

## 11.3 案例版权

每条案例必须有：

- `sourceName`
- `sourceUrl`
- `license`
- `attribution`
- `rightsStatus`
- `contentHash`
- `importedAt`

`rightsStatus` 非 `approved` 时不得进入生产检索。

---

# 12. 测试与评测

## 12.1 传统软件测试

### 单元测试

- Schema；
- 规则检查器；
- prompt renderer；
- patch/revise；
- storage migration；
- error mapping。

### 集成测试

- API 路由；
- OpenAI adapter mock；
- 结构化输出失败；
- 超时与重试；
- CORS；
- rate limit。

### E2E

使用 Playwright 验证：

- 打开侧边栏；
- 输入简报；
- 查看三方向；
- 复制；
- 收藏；
- 修改；
- 刷新后历史存在；
- API 失败状态；
- 键盘操作。

## 12.2 AI 行为评测

基准集至少覆盖：

- 简单摄影；
- 复杂企业展厅大屏；
- 带大量固定中文；
- 产品概念图；
- 3D 模型；
- 海报；
- 图片编辑；
- 分镜；
- 冲突约束；
- 极简输入；
- 禁止人物；
- 品牌颜色；
- 自定义比例；
- 跨媒介实验。

## 12.3 自动规则指标

每个样例记录：

- 固定文字逐字命中；
- 必须元素命中；
- 禁止项泄漏；
- 是否有单一视觉焦点；
- 方向差异轴数量；
- 冲突数量；
- JSON 合法性；
- prompt 长度；
- 空泛词密度；
- 案例相似度。

## 12.4 人工评测

采用盲测比较：

- 基线：用户输入直接交给文本模型扩写；
- 候选：Visual Prompt Compiler。

每个结果按 1–5 评分：

- 忠实；
- 清楚；
- 可执行；
- 视觉合理；
- 差异；
- 愿意直接复制。

记录胜、平、负，而不是只看平均分。

## 12.5 发布门

MVP 发布前建议满足：

- 结构化输出解析成功率 ≥ 99%；
- 固定文字保留率 ≥ 99%；
- 禁止项静态泄漏率 ≤ 1%；
- 三方向差异合格率 ≥ 90%；
- 无 P0/P1 安全问题；
- 基准集相对基线的人工偏好胜率达到预设门槛；
- 所有关键 E2E 通过。

如实际数据不足，不得伪造达标结论，应记录真实值。

---

# 13. 可观测性

记录但不保存敏感正文：

- requestId；
- promptVersion；
- schemaVersion；
- model；
- 成功/失败；
- 错误码；
- 延迟；
- usage；
- 是否修复；
- linter 问题数量；
- 用户是否复制/收藏/重写的匿名事件。

MVP 可使用结构化日志，不强制接入外部监控平台。

---

# 14. 里程碑

## M0：产品与评测基线

交付：

- 第一性原理确认；
- VisualSpec v1；
- API 契约；
- 10–20 条起始基准样例；
- 评分规则；
- 风险登记；
- 技术 ADR；
- 目录脚手架方案。

验收：

- 文档无重大矛盾；
- 所有非目标明确；
- 每个指标有计算方式；
- Schema 可被程序验证。

## M1：仓库脚手架与契约

交付：

- pnpm monorepo；
- TypeScript strict；
- contracts；
- Schema；
- lint/format/test；
- CI；
- README；
- `.env.example`；
- health endpoint；
- 扩展空侧边栏。

验收：

- 全新 clone 可按 README 启动；
- `pnpm check` 一次执行全部检查；
- CI 绿色；
- 扩展可在 Chrome 开发者模式加载。

## M2：编译器纯核心

交付：

- normalizer 接口；
- VisualSpec；
- variant planner；
- renderer；
- 确定性 linter；
- repair policy；
- fixture 测试。

暂不调用真实 OpenAI。

验收：

- 核心模块与 UI/API 解耦；
- 对固定 fixtures 输出稳定结构；
- 规则覆盖关键冲突；
- 测试覆盖核心分支。

## M3：OpenAI 服务端集成

交付：

- Responses API adapter；
- 结构化输出；
- 模型配置；
- compile/revise 路由；
- 超时、重试、错误归一化；
- 日志脱敏；
- mock 集成测试。

验收：

- API Key 不出现在客户端 bundle；
- 非法模型输出被捕获；
- 自动修复最多一次；
- 上游失败返回稳定错误码；
- 真实调用可通过手动 smoke test 验证。

## M4：Chrome 侧边栏完整主流程

交付：

- 简报表单；
- 结果三方向；
- 假设与风险；
- 复制；
- 收藏；
- 历史；
- 修改；
- 加载与错误状态；
- storage migration。

验收：

- Playwright 覆盖关键流程；
- 无障碍基础检查通过；
- 不申请无关权限；
- 刷新后本地数据存在；
- 可清除历史。

## M5：评测体系与提示词版本化

交付：

- 基准运行器；
- 自动规则报告；
- baseline 对比；
- promptVersion；
- 回归测试；
- 报告输出到 `artifacts/evals/`。

验收：

- 单命令执行评测；
- 每次提示词变化可比较；
- 失败样例可定位；
- 不用主观描述代替指标。

## M6：案例模式库实验

交付：

- 案例 Schema；
- 许可证检查；
- patternSummary；
- 简单检索；
- 检索开关；
- A/B 评测；
- 相似度检查。

验收：

- 默认是否启用由评测决定；
- 无权利案例不能生产使用；
- 检索关闭时系统仍完整工作；
- 输出无明显近似复制。

## M7：GPT Image 2 预览与图片反馈

交付：

- `/v1/generate`；
- 尺寸与费用保护；
- 预览图；
- 图片层审查；
- 从失败图生成 revise patch；
- 不默认持久化图片。

验收：

- 密钥与额度安全；
- 生成失败有明确恢复路径；
- 图片评价不覆盖用户硬约束；
- 预览功能可彻底关闭。

## M8：发布加固

交付：

- 隐私说明；
- 许可证清单；
- 安全审查；
- 性能优化；
- Chrome 打包；
- 发布检查表；
- 回滚方案。

验收：

- 无 P0/P1；
- 发布门达标或有明确豁免；
- 文档可供新开发者复现；
- 可从干净环境构建发布包。

---

# 15. 决策门

## Gate A：MVP 是否需要案例库

只有 M5 评测后决定。不能因“案例听起来有用”直接进入默认链路。

## Gate B：是否需要数据库

MVP 历史在浏览器本地。只有出现账号、多设备同步或团队功能时再引入数据库。

## Gate C：是否使用 Agents SDK

当前主链路是确定性编排 + 少量模型调用，优先直接使用 Responses API。只有需要多工具、长流程或可追踪 agent handoff 时再评估 Agents SDK。

## Gate D：是否进行微调

只有收集到足够、授权清晰且有评测证明的训练数据，并且提示词、RAG 和规则方法达到瓶颈时再评估。MVP 禁止。

---

# 16. 风险登记

| 风险 | 影响 | 缓解 |
|---|---|---|
| “美观”不可客观保证 | 用户预期失真 | 用可执行性、偏好胜率和预览反馈表达 |
| 固定中文生成不稳定 | 海报失败 | 明确文字层级、保真检查、提示用户二次排版 |
| 三方向趋同 | 产品价值下降 | 差异轴规则和自动评测 |
| 案例诱导复制 | 版权与原创风险 | 抽象模式、相似度检查、许可元数据 |
| 浏览器泄漏 API Key | 严重安全问题 | 服务端代理 |
| 模型输出格式变化 | API 失败 | Structured Outputs、Schema、adapter |
| 模型版本升级回归 | 行为漂移 | promptVersion + 基准评测 |
| 延迟过高 | 放弃使用 | 分阶段响应、超时、必要时减少模型调用 |
| 成本不可控 | 无法运营 | 额度限制、usage 记录、预览默认关闭 |
| 需求输入过少 | 输出臆造 | 显式假设、风险提示、允许补全开关 |
| 规则过度僵化 | 创造力下降 | 区分硬规则与软评分 |
| 采集案例权利不清 | 无法发布 | rightsStatus gate |

---

# 17. 环境变量

```dotenv
OPENAI_API_KEY=
OPENAI_TEXT_MODEL=
OPENAI_IMAGE_MODEL=gpt-image-2
API_PORT=8787
API_HOST=127.0.0.1
ALLOWED_EXTENSION_ORIGINS=
REQUEST_TIMEOUT_MS=45000
RATE_LIMIT_MAX=
LOG_LEVEL=info
ENABLE_CASE_RETRIEVAL=false
ENABLE_IMAGE_GENERATION=false
```

模型名必须可配置，测试不得依赖具体在线模型。

---

# 18. Codex 实施规则

- 首次使用先执行任务 0；
- 每个任务只做一个里程碑；
- 每个里程碑开始前更新 `docs/status.md`；
- 每个里程碑结束时输出：
  - 变更摘要；
  - 文件清单；
  - 运行命令；
  - 测试结果；
  - 已知风险；
  - 下一里程碑前置条件；
- 不允许通过扩大权限或跳过测试解决问题；
- 外部凭据缺失时，使用 mock 完成其余工作；
- 不得声称运行了未实际运行的命令；
- 不得自行发布、推送或创建付费资源。
