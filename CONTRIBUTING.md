# 贡献指南 / Contributing

感谢你愿意改进 `dsh-interim-narration`。这个项目刻意保持很小：**一个提示词契约 + 一个可选的应用内配置页**，没有第三方运行时依赖、没有构建步骤。

## 开发环境

- Node.js ≥ 20（仅用于跑测试；插件本身由 DSH 宿主加载）
- 任意 DSH 0.2.x 安装（桌面版或 headless profile 均可）

```bash
git clone https://github.com/ws1234567891011/dsh-interim-narration.git
cd dsh-interim-narration
node test/smoke.mjs        # 宿主逻辑：24 个用例
node test/client-smoke.mjs # 客户端 bundle：注册与渲染断言
# 或
npm test
```

## 目录结构

```
lib/core.js   纯逻辑 + 挂载（只 import Node 内置模块，可独立测试）
lib/index.js  schemastery Config（volatile 可编辑字段）与公共导出
lib/client.js 手写 Web bundle（window.__ModuleLoader__.load）注册配置页
test/         host / client 测试，以及 mock LLM 端到端脚本
```

修改行为时请同步：

1. `lib/core.js` 的提示词契约（中文 `zhText` 与英文 `enText` 要保持语义一致）；
2. `test/smoke.mjs` 增加或更新断言；
3. `README.md` 的「配置」表与 `CHANGELOG.md`。

## 提交约定

- 一个提交只做一件事；消息用祈使句（`add …`、`fix …`、`docs …`），必要时用中文也可；
- 不引入构建步骤或第三方运行时依赖（`@deepseek-ai/schemastery` 是宿主提供的 optional peer）；
- 不悄悄改动用户的显示设置（如 `ui-chat.transcriptView`），只通过文档建议。

## Pull Request

- 先开 issue 描述动机（除非是明显的 typo/文档修正）；
- CI 会在 Node 20/22/24 上跑两套测试，全部通过后再请求 review；
- 请在 PR 描述里附上验证方式（本地测试输出、或在 DSH 里观察到的效果）。
