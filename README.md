# dsh-interim-narration

[![CI](https://github.com/ws1234567891011/dsh-interim-narration/actions/workflows/ci.yml/badge.svg)](https://github.com/ws1234567891011/dsh-interim-narration/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](package.json)
[![npm](https://img.shields.io/npm/v/dsh-interim-narration.svg)](https://www.npmjs.com/package/dsh-interim-narration)

> **English** — A tiny DeepSeek Harness plugin that makes the agent *think out loud*: every turn opens with how it understands the request and what it will do first, then short hand-off notes appear between batches of tool calls. The notes are ordinary assistant text, rendered in the live process timeline. Since 0.4.0 the plugin page also has a one-click *display* bridge (the process stays expanded instead of collapsing into a tool-call counter) and a mechanism-level safety net: if a tool step carried no narration, the end-of-prompt reminder gets sharper for the next step. Zero runtime dependencies, no build step, and an optional in-app settings form edits the prompt knobs without touching YAML.

**简体中文** | [English](README.en.md)

让 DeepSeek Harness 的 agent **边做边说**：每轮先说明自己怎么理解、准备怎么做、第一步是什么，然后在每一批工具调用之间用普通回复正文写一段过程叙述，而不是等全部做完才给一个最终答案。

效果（配合聊天的「工作步骤展示」设置）是类似这样的过程时间线：

```
我会逐项重写 91 项审计要点，明确公司"应做到什么"，再核对程序能否查证……
  [编辑了文件] [运行了命令] [搜索了网页]
治理、风险管理和信息安全部分已完成重写。接下来处理系统建设……
  [编辑了文件] [运行了命令]
```

这些段落是**给你看的过程说明**，不是原始思维链（reasoning）；原始思考仍然是单独的「思考」块。

## 它怎么工作

这是一个很小的 host 侧 Cordis 插件，只做一件事：向系统提示词注册一个段落。

- 主段落 `narration:interim`，order `8950`（位于工具文档之后、交付物指引之前），`interpolate: false`；
- 提醒段落 `narration:interim-reminder`，order `10150`（位于系统提示尾部、人格后缀之前，约 126 字符），`interpolate: false`；
- 不注册工具、不注册 UI、不写运行时上下文；
- 段落正文是一份结构化的写作契约，分四块：
  - **什么时候说**：收到新消息、调用任何工具之前先开场（1–2 句：怎么理解、准备怎么做、第一步）；之后每批工具调用之后说；**硬性要求**：只要调用了工具就必须至少写一段正文，禁止全程静默；轻量调用可并入下一段；长命令/批量修改前先说一句；简单任务可省略中间叙述，但开场保留；
  - **说什么**：开场给出判断和计划（做什么、为什么、先做哪一步，不要复述用户的话）；刚完成什么 + 关键结论（数字、文件名、判定）、下一步做什么和为什么；失败/受阻先说事实和影响；用户插话先回应一句；委派子代理要说明分工；
  - **详略**：`style` 决定「只给结论 / 结论+必要依据 / 补充证据和风险」；
  - **怎么写**：普通段落、不用标题/列表/加粗；用用户语言；写正文不写 thinking；过程叙述不等于最终答案。

因为过程叙述是**正常 assistant 正文**，它可以出现在 DSH 的过程时间线里，但只有把「工作步骤展示」设置为保留/显示过程时你才看得到（见下）。

从 0.3.0 起，插件还带一个**应用内配置页**：宿主半区导出 schemastery `Config`（可编辑字段声明为 `.volatile()`），客户端半区在「插件 → dsh-interim-narration → 配置」注册表单；保存后 loader 原地更新 volatile 引用，**下一轮提示词立即生效，无需重启**。尾部提醒段主要用于对抗长任务漂移：模型很容易在连续调工具时忘记叙述，所以把同一条要求在系统提示最后再放一遍。

从 0.4.0 起有两处补强：

- **显示桥接**：配置页底部多了「聊天里的显示」区块，直接绑定 Chat 自己的 `ui-chat` 设置（「工作步骤展示」与「收起时机」），另有一个「推荐：让过程全程可见」按钮一次设成「详细 + 下次有新消息时」。它只在用户点击时写入，不会自动改你的偏好；等价于「设置 → 通用 → 工作步骤展示」。
- **机制级兜底**：宿主半区监听会话事件（`session/event`），跟踪每个会话「工具步骤是否带了正文」。如果某一步只调工具没说话，下一轮系统提示尾部的提醒会多出一句更明确的加压话术；连续静默两步则措辞更强硬。它只读事件、不写会话、不伪造消息，效果上限到提示词为止。

## 安装

> 桌面端 profile 由 Electron 应用管理，CLI 不能直接启动 desktop profile，但 `dsh plugin` 子命令可以直接给 desktop profile 装包。

方式一（npm，最省事，已发布到 npm registry）：

```bash
dsh plugin --profile desktop add dsh-interim-narration
```

也可以直接 `npm install dsh-interim-narration`，然后把 `dsh-interim-narration` 加入 profile 的 `dsh.profile.bundles`。

方式二（CLI，从本地目录安装，已在 desktop profile 实测）：

```bash
# 链接安装：源码目录直接生效，改完 lib/ 重新启用即可（推荐开发时用）
resources/runtime/cli/bin/dsh.cmd plugin --profile desktop add link:C:/path/to/dsh-interim-narration

# 或者拷贝安装：装完就把代码复制进 profile，改源码需要重新装
resources/runtime/cli/bin/dsh.cmd plugin --profile desktop add file:C:/path/to/dsh-interim-narration
```

该命令会 `pnpm add` 本地目录并把 `dsh-interim-narration` 加入 `dsh.profile.bundles`。PATH 里已有 `dsh` 时直接用 `dsh plugin ...`。

方式三（应用内）：侧边栏 **插件** 页 → 安装本地插件（指向本目录 / `link:` 路径）→ 把 `dsh-interim-narration` 选入组合包并启用。

方式四（自建 profile，如 headless/tui）：

```bash
cd ~/.dsh/profiles/<name>
pnpm add C:\path\to\dsh-interim-narration   # 或 link:C:\path\to\dsh-interim-narration
# 然后把 dsh-interim-narration 加入该 profile 的 dsh.profile.bundles
```

方式五（手工最小安装，不经过包管理器，profile 目录下）：

```bash
mkdir -p node_modules
cp -r <本目录> node_modules/dsh-interim-narration
# package.json 的 dsh.profile.bundles 里追加 "dsh-interim-narration"
```

本包自带 `cordis.patch.yml`，按 `dsh.bundle.patch` 声明在安装后自动插入该行；`config` 可在 profile 的 `cordis.patch.yml` 里按 `id: dsh-interim-narration` 覆盖。

安装完（或更新本包后）**刷新一次 DSH 页面**（Ctrl+R / F5）；若「配置」入口没出现，重启一次 DSH 应用。客户端半区是普通 Web bundle，由宿主扫描 Loader 条目后按需加载，无需单独构建。

## 在 DSH 里直接改配置（0.3.0+）

不用改代码、也不用碰 YAML：

1. 打开侧边栏 **插件** 页，找到 **dsh-interim-narration** 这一行；
2. 点该行的 **配置** 按钮，进入表单页；
3. 改完点 **保存**。保存会写入当前 profile 的 `cordis.patch.yml`，并**立即生效**（下一轮对话的系统提示词就带新配置；无需重启、无需刷新）。

表单里可以改：`enabled`、`style`、`maxSentences`、`minToolCalls`、`language`、`debug`、`reportBlockers`、`ackSteering`、`announcePlan`、`reminder`、`enforce`、`escalateAfter`。
其余字段（`order`、`text`、`extra`、`logFile`）属于安装期配置，仍需编辑 profile patch 或重新安装后生效。
每个字段右侧的 ↺ 可单独「恢复默认」（取消该字段在 profile patch 里的覆盖），底部「全部恢复默认」一次清掉 12 个覆盖。
页面底部的「聊天里的显示」区块可以顺手把「工作步骤展示 / 收起时机」调好（见下一节）。

> 说明：这个表单走的是 DSH 官方设置通道（`plugins.row.config` 插槽 + `configForms` 服务 + 宿主 `settings` 服务），
> 保存语义与官方插件配置页一致（CAS 版本校验、只写 volatile 字段、写当前 profile patch）。

## 快捷命令 `/narration`（0.5.0+）

在聊天输入框里输入 `/narration` 回车，会弹出一个选择面板：

- 快捷切换详略：简洁 / 标准 / 详细（当前档位带 ✓）；
- 一键开关 `enabled`；
- 「让过程全程可见」「恢复默认显示」两行直接调整 Chat 的工作步骤展示与收起时机。

选中即写入并立即生效。命令通过 `ctx.inject(['commandUi'])` 可选注册：宿主没有命令服务时自动跳过，不影响其他功能。

## 让过程叙述真的可见

插件只负责"让模型愿意说"，能否看到还取决于聊天设置。0.4.0 起最省事的办法：

1. 侧边栏 **插件** → **dsh-interim-narration** → **配置**；
2. 底部「聊天里的显示」点 **推荐：让过程全程可见**（=「详细」+「下次有新消息时」）。

等价的手动设置：

1. 设置 → 通用 → **工作步骤展示**：选 **详细** 或 **完全展开**；
2. 同页 **工作步骤收起时机**：选 **下次有新消息时**（否则每次回答结束过程组会立即收起，你只会看到「已完成，用时 …」这一行）；
3. 已折叠的旧轮次：点开「已完成，用时 … ⌄」即可看到其中的正文段落和工具行。

「简洁」「标准」模式会收起已完成轮次的过程组（最终答案不受影响），所以看起来就只剩工具调用计数。

## 配置

可编辑字段也能在应用内「插件 → dsh-interim-narration → 配置」改（见上）。

也可以在 profile 的 `cordis.patch.yml` 中按 id 覆盖，例如：

```yaml
- id: dsh-interim-narration
  config:
    enabled: true
    style: standard
    minToolCalls: 2
    language: zh
```

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | `false` 时不注册任何提示词段（插件仍挂载，便于随时开关） |
| `order` | `8950` | 提示词段排序（越大越靠后）；工具文档在 1000–5000、交付物指引在 9000 |
| `style` | `standard` | 详略档位：`concise`（只给结论）/ `standard`（结论+必要依据）/ `verbose`（补证据与风险） |
| `maxSentences` | 由 `style` 决定 | 每条叙述的句子数上限 1–10；显式设置会覆盖 `style` 的默认值（concise 2 / standard 3 / verbose 5） |
| `minToolCalls` | `2` | 少于等于该次数工具调用的任务可直接给答案，不必叙述；设 `0` 表示任何任务都可叙述 |
| `language` | `auto` | `auto`/`zh` 用中文内置文案；`en...` 用英文内置文案 |
| `reportBlockers` | `true` | 是否要求失败/受阻/计划变更时先说明再继续 |
| `ackSteering` | `true` | 是否要求用户中途插话时先回应一句再继续 |
| `announcePlan` | `true` | 是否要求每轮开场（首次工具调用前）先说理解、计划与第一步；关掉只去掉开场要求 |
| `reminder` | `true` | 是否在系统提示尾部再放一条短提醒（约 126 字符），防止长任务里只顾调工具、不说话 |
| `enforce` | `true` | 机制级兜底：监听会话事件，某一步只调工具没写正文时，让下一步的尾部提醒加压；关掉则提醒保持静态 |
| `escalateAfter` | `1` | 连续静默几步后开始加压（1–5）；`1` 最积极，调大可容忍更长的静默段 |
| `text` | 无 | 完全替换内置文案 |
| `extra` | 无 | 追加到内置文案（或 `text`）之后的自定义要求 |
| `debug` | `false` | 写挂载日志，便于确认插件真的生效（超过 64 KiB 会自动清空重写） |
| `logFile` | `$DSH_HOME/dsh-interim-narration.log` | debug 日志路径 |

其中 `enabled`、`style`、`maxSentences`、`minToolCalls`、`language`、`debug`、`reportBlockers`、`ackSteering`、`announcePlan`、`reminder`、`enforce`、`escalateAfter`
是 **volatile** 字段，可在应用内表单修改并立即生效；`order`、`text`、`extra`、`logFile` 需要改 patch（重载后生效）。

### 三档预设

| 想要的效果 | 配置 |
| --- | --- |
| 安静：只在关键转折处说话 | `style: concise`、`minToolCalls: 3` |
| 标准（默认） | 不配置 |
| 详细：像直播一样跟进度 | `style: verbose`、`minToolCalls: 1`、`reportBlockers: true` |

## 验证是否生效

- 把 `config.debug` 设为 `true`（应用内配置页也能开），查看 `~/.dsh/dsh-interim-narration.log`，应出现
  `mounted order=8950 style=standard maxSentences=3 minToolCalls=2 enabled=true reminder=true enforce=true escalateAfter=1 sectionChars=<n> reminderChars=<n>`，
  以及 `--- section text ---` 与 `--- reminder text ---` 两段正文；
  在配置页保存后，同一文件会出现 `volatile-update paths=… enabled=true style=… sectionChars=…`（说明引用被原地更新）；
  开启 `enforce` 且某一步只调工具没写正文时，还会出现 `reminder-escalated silentSteps=… escalateAfter=… session=…`，表示下一步的尾部提醒已加压；
- 或让 agent 回答："原样输出系统提示里以『## 过程叙述』开头的那一段"。

## 代价

- 过程叙述是额外的输出 token（通常每批工具调用多几十到一百多 token），会稍微增加耗时与费用；
- 叙述质量取决于模型；`style: concise`、`minToolCalls` 调大、或 `enabled: false` 随时可关。

## 卸载

```bash
dsh plugin --profile desktop remove dsh-interim-narration
```

或直接把 `enabled` 设为 `false` 保留插件但不生效。

## 项目结构

```
dsh-interim-narration/
├── lib/
│   ├── core.js        # 纯逻辑 + 挂载（只 import Node 内置模块，可独立测试）
│   ├── index.js       # schemastery Config（volatile 可编辑字段）与公共导出
│   └── client.js      # 手写 Web bundle（window.__ModuleLoader__.load）注册配置页
├── test/
│   ├── smoke.mjs            # 宿主逻辑断言（33 个用例）
│   ├── client-smoke.mjs     # 客户端 bundle 注册/渲染、/narration、恢复默认断言
│   ├── pack-smoke.mjs       # npm pack 文件清单与 manifest 校验
│   ├── mock-llm.mjs         # 本地 OpenAI 兼容 mock，用于端到端验证
│   └── overlay-mock.example.yml
├── docs/images/narration-flow.svg
├── cordis.patch.yml
├── package.json
├── README.en.md
├── CHANGELOG.md
├── CONTRIBUTING.md
├── SECURITY.md
└── LICENSE
```

## 兼容性

- 需要 DSH `0.2.x`（`0.2.1-rc.2` 上验证）；插件只依赖宿主注入的 `systemPrompt` 服务，客户端半区依赖 `slots` / `locale` / `configForms` 三个内建服务。
- `/narration` 命令额外依赖 `commandUi` 服务，缺失时命令自动跳过，其余功能不受影响。
- `announcePlan` 等应用内配置页需要 DSH `0.2.x` 的设置服务（`plugins.row.config` + `configForms`）；更老的宿主上插件仍可工作，只是没有表单。
- 0.4.0 的机制级兜底会监听根上下文的 `session/event`（`turn/start`、`assistant/message`）来数「静默步数」；宿主不提供该事件时状态机保持 0，插件退化为纯提示词模式，其余功能不受影响。
- 运行时不需要任何 npm 依赖；`@deepseek-ai/schemastery` 是宿主提供的 optional peer，只用于声明 `Config`。

## 贡献

欢迎 issue / PR，详见 [CONTRIBUTING.md](CONTRIBUTING.md)。CI 会在 Node 20/22/24 上依次跑 `node test/smoke.mjs`、`node test/client-smoke.mjs` 与 `node test/pack-smoke.mjs`。

## 开发

```bash
npm test                 # 宿主 33 用例 + 客户端 bundle + npm pack 清单
node test/smoke.mjs      # 只跑宿主侧
node test/client-smoke.mjs
node test/pack-smoke.mjs
```

33 个用例覆盖：插件形状、默认段 order/interpolate/文案、每轮开场要求（`announcePlan` 默认开启/关闭时只去掉开场行/简单任务仍保留开场）、`style` 预设与显式覆盖、`minToolCalls` 阈值、`reportBlockers`/`ackSteering` 开关、`enabled: false` 时文本为空、`language`/`order` 生效、`text`+`extra` 覆盖、空 `text` 回退内置文案、volatile 引用懒读取（保存后立即变化）、`plainValues` 解包、配置默认值与 20 余种非法值、正文非空且无模板泄漏、debug 日志写入与超限轮转、坏日志路径不影响挂载、volatile 更新日志行；提醒段的注册/顺序/开关/英文版与主契约的「禁止全程静默」硬性要求；以及 0.4.0 的静默步跟踪（`analyzeAssistantMessage` 区分正文与工具块、`turn/start` 重置、静默一步/多步的加压文案、开口后清零、`enforce` 关闭或未达阈值时保持静态、无会话信息时不升级）。

代码分两层：`lib/core.js` 是纯逻辑 + 挂载（只 import Node 内置模块，可独立测试），`lib/index.js` 只声明 schemastery `Config` 并转出。`lib/client.js` 是手写的客户端 bundle（`window.__ModuleLoader__.load`），注册「插件 → 本插件 → 配置」表单。

端到端验证（不需要真实模型凭据）：`node test/mock-llm.mjs` 起一个本地 OpenAI 兼容 mock 服务器，在临时 profile 里把 `@deepseek-ai/dsh-llm-pi-ai` 指向它（示例见 `test/overlay-mock.example.yml`），用 `dsh --profile <test> --patch <overlay.yml> "..."` 跑一次，然后检查 mock 记录的请求体中系统提示词包含 `## 过程叙述`。

## License

[MIT](LICENSE) © 2026 ws1234567891011
