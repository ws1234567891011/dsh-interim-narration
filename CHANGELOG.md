# Changelog

## 0.6.0

- **语言自适应**：`language: auto` 现在跟随你最近一条用户消息的语言——中文消息用中文契约、
  英文消息用英文契约（`## Interim narration` / `## Narration reminder`），不再固定中文。
  新增 `detectLanguage`（CJK 占比 ≥20% 且 ≥2 字判中文；≥8 个拉丁字母且无 CJK 判英文）、
  `analyzeUserMessage`、`resolveLanguage`（显式 `zh`/`en` 优先，`auto` 用会话检测值，兜底中文）；
  语言状态挂在会话跟踪器里，`turn/start` 不清除。
- **句数跟随档位**：`maxSentences: 0`（新默认）表示跟随 `style` 预设（简洁 2 / 标准 3 / 详细 5 句），
  设置 1–10 才覆盖；配置页在 0 时显示「跟随档位：N 句」，`/narration` 的档位行也会提示建议句数。
- **配置页分区**：字段重组为「基本 / 开场与提醒 / 进阶 / 聊天里的显示」四块，长表单更好扫读。
- **会话状态有界**：跟踪器改为 LRU，最多保留 200 个会话（按最近访问排序，超出淘汰最旧），
  长期运行不会无限增长；最坏情况只是丢掉一次静默计数。
- 兼容性：`language: auto` 依赖 `session/event` 里的用户消息文本；宿主不提供该事件时回落中文
  （与 0.5 行为一致），显式 `zh`/`en` 不受影响。
- 测试：宿主 33 → 38 个用例（语言检测/解析、跟随用户消息切换契约、句数 0 跟随档位、LRU 上限），
  `client-smoke` 增加分区标题、跟随提示、`maxSentences` 输入下限断言。
- 版本 0.6.0。

## 0.5.0

- **`/narration` 斜杠命令**：在聊天输入框里输入 `/narration` 可以打开一个选择面板，直接切换
  `style` 三档（当前档位带 ✓ 标记）、开关 `enabled`、或一键把聊天显示设成「过程全程可见 / 恢复默认」。
  命令通过 `ctx.inject(['commandUi'])` 可选注册：宿主没有命令服务时自动跳过，不影响其余功能。
- **配置页增强**：每个字段右侧新增 ↺「恢复默认」按钮（单字段 `unset`），底部新增「全部恢复默认」
  （一次 12 个 unset）；`style` 行补充档位与句数的联动提示；显示区块新增「当前：详细 · 下次有新消息时」摘要；
  恢复默认后立即按新快照重填表单。
- **英文文档**：新增 `README.en.md`（完整英文说明），主 README 顶部互链。
- 新增 `docs/images/narration-flow.svg` 流程图；`package.json` 的 `files` 增加 `docs`、`README.en.md`、`SECURITY.md`。
- 仓库工程化：新增 `SECURITY.md`、`.github/ISSUE_TEMPLATE/bug_report.md`、`feature_request.md`、
  `.github/PULL_REQUEST_TEMPLATE.md`；CI 增加 `node test/pack-smoke.mjs`。
- 测试：新增 `test/pack-smoke.mjs`（校验 `npm pack` 的文件清单与 manifest），`client-smoke` 扩展覆盖
  命令注册/选项/选择写入与恢复默认按钮；`npm test` 现在一次跑三套测试（宿主 33 用例 + 客户端 + 打包）。
- 版本 0.5.0。

## 0.4.0

- **看得见：显示桥接**。配置页底部新增「聊天里的显示」区块，直接绑定 Chat 的 `ui-chat` 设置：
  「工作步骤展示」（简洁/标准/详细/完全展开）与「收起时机」（回答结束后/下次有新消息时），
  并提供 **推荐：让过程全程可见** 一键按钮（=「详细」+「下次有新消息时」）。
  只在用户点击时写入（`configForms` + CAS 版本校验，冲突自动重试一次），不会默认篡改用户偏好；
  等价于「设置 → 通用 → 工作步骤展示」。
- **真兜底：机制级提醒加压**。宿主半区监听根上下文 `session/event`，跟踪每个会话的「静默工具步」：
  `turn/start` 重置；`assistant/message` 中若有非空 `text` 块则清零，只有 `tool-call` 块则计数（reasoning 不算）。
  尾部提醒段改为读取 `context.agent.session` 的状态：静默达到阈值时追加一句更明确的「上一步没写叙述」，
  连续多步则措辞更强硬。只读事件、不写会话、不伪造消息。
- 新增可配置项（均为 volatile）：`enforce`（默认 `true`，机制级兜底开关）、`escalateAfter`（默认 `1`，1–5，
  连续静默几步开始加压）；volatile 字段从 10 个增加到 12 个，配置页表单同步新增两行。
- 客户端配置页新增显示区块与两行新配置；`client-smoke` 覆盖 `ui-chat` 写入、推荐按钮一次写两字段、
  与插件自身命名空间保存互不影响。
- 测试 27 → 33 个（静默步状态机、`analyzeAssistantMessage`、重置与清零、加压文案、关闭兜底、无会话降级）。
- 兼容性：宿主未提供 `session/event` 时状态机保持 0，插件退化为纯提示词模式；其余功能不受影响。

## 0.3.2

- **补救「长任务里只顾调工具、不说话」**：新增第二个提示词段 `narration:interim-reminder`
  （order `10150`，位于系统提示尾部、人格后缀之前，约 126 字符），在模型开始工作前再提醒一次：
  调用第一个工具前先写 1–2 句理解与计划，之后每批工具之间写进展，不要整轮只调工具。
- 主契约新增**硬性要求**：只要这一轮调用了工具，就必须至少写一段过程叙述正文，不允许「工具调用 → 工具调用」
  全程静默（开场段和批次间段落都算）。主契约从 752 字符变为 820 字符。
- 新增可配置开关 `reminder`（默认 `true`，应用内配置页「在提示词末尾加一条提醒」）：可单独关闭尾部提醒；
  volatile 字段从 9 个增加到 10 个。
- 提醒文案跟随 `announcePlan` 与 `language`：关掉开场要求时提醒只要求「先写一句准备做什么」；英文配置输出英文提醒。
- debug 日志新增 `reminder=true ... reminderChars=<n>` 与 `--- reminder text ---` 段，便于确认两段都挂载。
- 测试 24 → 27 个（提醒段注册/顺序/内容、reminder 开关、英文提醒、主契约硬性要求、双段挂载）。
- 已发布到 npm：`npm i dsh-interim-narration` / `dsh plugin add dsh-interim-narration`
  （https://www.npmjs.com/package/dsh-interim-narration）。

## 0.3.1

- **每轮开场先说**：提示词契约新增要求——收到新消息后、调用任何工具之前，先用 1–2 句正文说明
  怎么理解这条消息、准备怎么做、第一步是什么；并在「说什么」里要求开场段落给出判断与计划，不要复述用户的话。
  这样用户一发消息就能看到思考方向，而不是等第一批工具调用结束后才开口。
- 新增可配置开关 `announcePlan`（默认 `true`，应用内配置页「开场先说理解与计划」）：关掉后只去掉开场要求，
  其余契约不变。volatile 字段从 8 个增加到 9 个。
- 开场不受「简单任务免叙述」影响：`minToolCalls` 只豁免中间叙述，简单任务仍保留开场（用户明确要求每轮都先看到想法）。
- 文案：中英文契约同步更新；模板拼接避免关闭开关时出现空行。
- 测试 20 → 24 个（默认含开场规则、关闭时只去掉开场行、简单任务仍保留开场、英文版同样开场）；真实 desktop 配置
  `language: zh` 保持不变。

## 0.3.0

- 新增**应用内配置页**：在「插件 → dsh-interim-narration → 配置」直接改参数，保存即生效，不用改代码或 YAML。
  - 宿主半区导出 schemastery `Config`，可编辑字段声明为 `.volatile()`；设置保存走 DSH 官方 `settings` 服务，
    写入当前 profile 的 `cordis.patch.yml`，loader 原地更新引用，下一轮提示词立即生效（无需重启）。
  - 客户端半区 `lib/client.js`（手写 `window.__ModuleLoader__.load` bundle）注册 `plugins.row.config` 插槽，
    直连 `configForms` 服务（CAS 版本校验、只写 volatile 字段）；中英文案、摘要视图、保存/撤销与错误提示。
  - 可改字段：`enabled`、`style`、`maxSentences`、`minToolCalls`、`language`、`debug`、`reportBlockers`、`ackSteering`；
    `order`、`text`、`extra`、`logFile` 仍属安装期配置。
- 代码拆分为 `lib/core.js`（纯逻辑 + 挂载，仅 Node 内置模块，便于测试）与 `lib/index.js`（schema + 转出）。
- 修复：schema 默认 `text: ''` 会把提示词段清空（`sectionChars=0`）——空字符串现在回退到内置文案。
- 测试从 16 个扩到 20 个（volatile 懒读取、`plainValues` 解包、空 text 回退、volatile 更新日志等）。
- README：新增「在 DSH 里直接改配置」章节与生效/刷新说明。

## 0.2.0

- 重写内置提示词：从「一段规则」升级为结构化写作契约，分「什么时候说 / 说什么 / 怎么写」，
  新增去重、禁止空话、长命令/批量修改先说明、失败与计划变更先说、用户插话先回应、委派子代理说明分工等要求；
  并明确「过程叙述不是最终答案」，避免与最终回答重复。
- 新增 `style` 档位（`concise` / `standard` / `verbose`），默认 `standard`；`maxSentences` 默认值随档位变化
  （2 / 3 / 5），显式设置时以显式值为准。
- 新增 `minToolCalls`（默认 `2`）：简单任务阈值可配置，不再写死；设 `0` 表示所有任务都可叙述。
- 新增 `reportBlockers`（默认 `true`）与 `ackSteering`（默认 `true`）两个开关，可单独关掉对应要求。
- debug 日志增加 `style` / `minToolCalls` 字段；日志超过 64 KiB 自动清空重写，避免长期运行无限增长。
- 测试从 7 个扩到 16 个：档位与显式覆盖、开关组合、18 种非法配置、模板泄漏检查、日志轮转、坏日志路径。
- README：补充三档预设、链接安装（`link:`）与拷贝安装（`file:`）的区别。

## 0.1.0

- 首个版本：host 侧 Cordis 插件，只注册一个 system-prompt 段（`narration:interim`，order `8950`），
  要求 agent 在工具调用批次之间用正文写 1–3 句过程叙述（边做边说）。
- 配置项：`enabled` / `order` / `maxSentences` / `language` / `text` / `extra` / `debug` / `logFile`。
- 中文（默认）与英文内置文案；`text` 可整体替换、`extra` 可追加。
- `test/smoke.mjs`：7 个单元用例；已用本地 OpenAI 兼容 mock 端到端验证提示词段进入模型请求。
