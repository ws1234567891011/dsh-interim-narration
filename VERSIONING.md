# 版本与发布声明

从 **1.0.0** 起，本项目按语义化版本（SemVer）发布，并且**每个版本都必须留下可查的声明**。这条规则不是口头约定：发布工作流会先运行 `node test/release-check.mjs`，版本号、`dsh.engines.dsh` 或 CHANGELOG 条目缺任何一样，发布直接失败。

## 版本号怎么变

| 变化 | 版本位 | 例子 |
| --- | --- | --- |
| 修 bug、改文案、调整默认值、不改变外部契约 | patch（1.0.x） | 修一个折叠后仍显示过程的边界情况 |
| 新增配置项、新增设置控件/命令、新增可选行为，旧用法不受影响 | minor（1.x.0） | 新增一种叙述档位 |
| 改动已有的包导出、Config 字段语义、设置插槽、`/narration` 命令或提示词契约的兼容性；或提高最低 DSH/Node 版本 | major（x.0.0） | 移除某个旧的 Config 字段 |

插件在 1.x 内承诺：

- 已发布的 `lib/index.js` / `lib/client.js` 导出、Cordis 行 id（`dsh-interim-narration`）、设置页位置与 `/narration` 命令保持兼容；
- `Config` 里已有的字段名和取值语义不删除、不改变含义；新增字段一律带默认值；
- 不要求用户改 profile 的 `cordis.patch.yml` 才能继续用；
- 支持的宿主范围写在 `package.json` 的 `dsh.engines.dsh` 里（当前 `>=0.2.1-rc.0 <0.3.0`）；扩大或缩小范围都算需要声明的变更。

## 每次发布必须做的四件事

1. **CHANGELOG.md**：在顶部加 `## <version>`，至少写清「改了什么、用户要不要做动作、有没有兼容性影响」。这是发布前的硬性检查项。
2. **GitHub Release**：tag 必须是 `v<version>`，Release 正文写同一份声明（工作流会自动生成一部分，发布前人工补一句重点）。
3. **npm**：`package.json` 的 version 必须与 tag 完全一致；`npm publish` 由 release 工作流执行。
4. **README**：如果安装方式、默认行为、兼容范围变了，同步更新中文与英文 README 的对应段落。

## 发布检查清单

```bash
# 1. 写 CHANGELOG 并升版本
node test/release-check.mjs v1.0.0   # 声明检查（失败就不要打 tag）
npm test                              # host + client + pack 三套测试

# 2. 提交、打 tag、推送
git add -A && git commit -m "v1.0.0: ..."
git tag -a v1.0.0 -m "v1.0.0"
git push origin main && git push origin v1.0.0
```

推 tag 会触发 `.github/workflows/release.yml`：版本守卫 → 声明检查 → 三套测试 → 打包 → 发布 npm → 创建 GitHub Release（资产名固定为 `dsh-interim-narration.tgz`）。

## 为什么这样要求

「升级声明」是给用户、也是给未来的自己看的：安装插件的人要在升级前知道会不会坏、要不要改配置；维护者要在半年后还能回答「这个版本改了什么、为什么改」。每次版本号的跳动，都应该能在 CHANGELOG 和 Release 里找到对应的那句话。
