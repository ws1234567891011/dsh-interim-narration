# Changelog

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
