# 参与开发 / 维护者指南

面向**改动这个仓库的人**。普通安装和使用看 [README.md](README.md)。

---

## 1. 环境

| 项目 | 版本 |
|---|---|
| Windows | 11（唯一验证过的平台） |
| Node.js | ≥ 22.19 |
| DSH | **0.2.0-rc.2** 与 **0.2.1-rc.3**（Electron 桌面版）；两者共用同一份 `lib/client.js` |
| PowerShell | **Windows PowerShell 5.1**（唯一目标；本机没有 pwsh 7，不要用 7 的语法） |
| 浏览器 | Edge / Chrome（Chromium 155 实测） |

macOS / Linux 的代码路径存在但**未测试**，改动它们请自行标注。

---

## 2. 仓库结构

```
lib/index.js          宿主半：四条已认证路由（copy.file / copy.path / copy.probe / copy.raw）
lib/presented.mjs     坐标 → 路径；含"文件已删仍给路径"的声明解析
lib/clipboard.mjs     CF_HDROP 写入 + 回读校验（Windows .NET Clipboard）
lib/client.js         浏览器半（手写：一个 occupant、两种外观、卡片交互）
cordis.patch.yml      bundle 补丁：只插入本包一行，不禁用任何原生行
scripts/              安装 / 卸载 / 校验
tests/                不需要 GUI 的测试
```

---

## 3. 本地验证

```powershell
# 不碰真实剪贴板的三个套件（任何沙箱都能跑）
node tests/presented.test.mjs
node tests/routes.test.mjs
node tests/client.test.mjs

# 真机剪贴板（会覆盖系统剪贴板；沙箱里会 skip 5 条）
node tests/clipboard.test.mjs

# 已安装时的只读校验
powershell -ExecutionPolicy Bypass -File scripts/verify.ps1
powershell -ExecutionPolicy Bypass -File scripts/verify.ps1 -ExpectAbsent   # 卸载后
```

`verify.ps1` 的第 [4] 段要跑 `dsh --profile web --dump-config`，它会在 profile 里写 `cordis.yml`；
在受限沙箱里这一步显示 `SKIP` 而不是失败——到普通终端重跑即可。

---

## 4. 改动浏览器半：直接改 `lib/client.js`

`lib/client.js` 是手写源码，没有生成步骤，也没有上游副本：

```powershell
node tests/client.test.mjs   # 模块 id、两个 occupant、字典键成对
```

规则：

- 组件只注册**一个 occupant**（`id: 'copy-file'`）到 `deliverables.file.actions` 与其审查卡孪生槽位；**永远不要 disable `ui-open-in-app`**，也不要复制上游实现。
- 卡片手势靠 `anchor.closest('[data-presented-file]')` 从自己的锚点往上找，所以不要假设自己渲染在原生按钮内部。
- 新增文案一律加进 `lib/client.js` 末尾的 `zh` / `en` 两份字典（键必须成对），不要硬编码在组件里。
- 新槽位 id、locale 命名空间都用本包自己的名字（`copy-file`），避免热切换瞬间与别的插件重复注册。
- 升级 DSH 后：正常只需重装。若哪天 `deliverables.file.actions` 不再是 list 槽位或 props 改名，症状是"卡片上没有复制图标"——先看 `verify.ps1` 的 `[2]` 段。

---

## 5. 版本与发版

```powershell
# 1) 版本号与 CHANGELOG
#    package.json 的 version、CHANGELOG.md 顶部新增一节
# 2) 提交 + tag
git add -A
git commit -m "chore: release vX.Y.Z"
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin main
git push origin vX.Y.Z
# 3) GitHub Release（写清楚"已验证项 / 已知限制 / 安装命令"）
# 4) npm（可选；发布前确认 npm whoami 有登录）
npm publish --access public
```

npm 的注意事项：

- **72 小时后不可删除**，只能 `npm deprecate`；版本号只能往上升，不能覆盖。
- 发布前先 `npm pack --dry-run` 看清单（由 `package.json` 的 `files` 决定）。
- 包名 `dsh-copy-file` 已在 registry 查询过可用；若将来被占，改名同时要改 `cordis.patch.yml` 里的行名。

---

## 6. 安全约定（提交 PR 前自查）

- **不改 DSH 安装目录**：这个项目只写 `%USERPROFILE%\.dsh\profiles\<profile>`，永远不碰 `node_modules\@deepseek-ai\*`。
- **不写死本机路径 / 用户名**：脚本里用 `$env:USERPROFILE`、`$env:DSH_HOME`。
- **不在日志或提交里出现 token**：PAT、登录令牌一律只放变量，不 print。
- **截图必须脱敏**：只截控件本身；不能出现主目录路径、工作区名、会话标题、真实文件名。规则见 [docs/screenshots/README.md](docs/screenshots/README.md)。
- **路由只接受坐标**：`sessionId` / `seq` / `index`；任何"让前端传路径"的改动都应被拒绝。
- **不新增运行时依赖**：目前依赖数为 0，请保持。
- **所有 `.ps1` 必须能被 Windows PowerShell 5.1 解析**：文件带 UTF-8 BOM（否则 5.1 按 ANSI 读、中文引号会被吃掉）、只用 5.1 语法；改完用
  `powershell -NoProfile -Command "$e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile(\"<file>\",[ref]$null,[ref]$e); $e.Count"` 验证为 0。
- **不要用 `$Home` / `$Input` / `$Host` 当参数名**：它们是只读自动变量，`$HarnessHome` 才是安全命名。

---

## 7. 提交信息

用 Conventional Commits 前缀，正文语言中英皆可：

```
feat: ...     新功能
fix: ...      修 bug（行为变化写进 CHANGELOG）
docs: ...     文档 / 截图
test: ...     测试
chore: ...    版本、构建、杂项
```

一次提交只做一件事。`lib/client.js` 是源码，改了它就在同一个提交里带上 `tests/client.test.mjs` 的相应断言——`verify` 会跑那份测试。
