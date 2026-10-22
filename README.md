# dsh-copy-file

**把 DSH 文件卡片里的"文件本体"放进系统剪贴板** —— 不是复制路径，不是复制文本，而是真正能在资源管理器 / 微信 / 飞书 / 邮件附件里 `Ctrl+V` 出来的文件。

[English](README.en.md) | 中文

---

## 它解决什么问题

DSH（DeepSeek Harness）用 `present` 展示交付文件时，卡片上只能"打开 / 在侧栏预览 / 显示文件位置"。想把这个文件发给别人，只能先打开它、再另存为。

浏览器做不到这件事：Clipboard API 只能写文本和位图，**没有任何办法把文件列表写进系统剪贴板**（Windows 需要 `CF_HDROP`）。所以这个扩展做了一件很直接的事：

> 浏览器里点菜单 → 请求 **同一个域名下、已登录认证** 的 DSH 路由 → 宿主按会话日志里的坐标解析出真实路径 → 由**一个短命的 PowerShell 子进程**调用 `Clipboard.SetFileDropList` 把文件放进剪贴板。

文件路径**从来不由浏览器提供**。前端只能传"哪个会话、第几条交付事件、第几个文件"，宿主自己去会话日志和 Session 文件系统里查。这就是它敢开源、敢直接用在你机器上的原因。

---

## 你会得到什么

菜单里多三项（原来那组"打开方式"和"显示文件位置"一个都没动）：

| 菜单项 | 行为 |
|---|---|
| **复制文件** | 文件本体进剪贴板（CF_HDROP）。可以粘到资源管理器、微信、飞书、邮件附件区 |
| **复制全部 N 个文件** | 同一次 `present` 的全部文件一次放进剪贴板（仅当 N > 1 时出现） |
| **复制文件路径** | 把绝对路径作为**文本**放进剪贴板 |
| 失败时 | 自动降级为"复制路径"，并用 toast 说明**原因**（文件已被删除 / 剪贴板被占用 / 不支持的系统…），不会假装成功；如果连路径都写不进剪贴板，才显示「复制失败，请重试」 |

卡片本身还获得 Windows 风格的交互（可选，默认开启）：

- **单击 = 选中**（底色直接用 DSH 自己的 hover 变深，没有发明新视觉）；
- **双击 = 在右侧栏打开预览**（Enter / Space 同样可以）；
- **选中后 `Ctrl+C` = 复制这个文件**；
- **拖动卡片**：跟随鼠标的半透明 ghost（DSH 现成文件图标 + 小字号文件名），
  - 在**页面内**松手 → 作为当前对话的附件（所有浏览器可用）；
  - 拖到**资源管理器**松手 → 落地一份副本（仅 Chromium）。

## 截图

三张图都来自真实 `dsh web` 会话，并且**只裁到控件本身**，所以看不到工作区路径、会话标题或文件名：

| 菜单里的三项 | 复制成功 | 降级提示 |
|---|---|---|
| ![菜单](docs/screenshots/01-menu.png) | ![成功 toast](docs/screenshots/02-success.png) | ![降级 toast](docs/screenshots/03-degrade.png) |


## 支持范围

| 能力 | Edge / Chrome / Brave / Opera 等 Chromium | Firefox | Safari |
|---|---|---|---|
| 复制文件 / 复制全部 / 复制路径 | ✅ | ✅ | ✅ |
| 单击选中、双击预览、Ctrl+C | ✅ | ✅ | ✅ |
| 拖进对话（附件） | ✅ | ✅ | ✅（14.1+） |
| 拖到资源管理器落地副本 | ✅ | ❌ 浏览器不支持 | ❌ |

**"复制"不挑浏览器**：写剪贴板发生在本地宿主进程里，跟浏览器无关。
**"拖出去"只有 Chromium 行**：靠 `dataTransfer` 的 `DownloadURL`，Firefox/Safari 没有这个能力，所以那两个浏览器上**不会出现拖拽**（不给你一个拖了没反应的假动作）。

平台：**Windows 11 + `dsh web`**，已实测。macOS / Linux 的代码路径已实现（`osascript` / `wl-copy`·`xclip`），**未测试**，不要当成品用。

---

## 安装

前提：Node 22.19+、`dsh` 0.2.0-rc.2、已经能跑 `dsh web`。

```powershell
# 1) 克隆到任意位置
git clone <this-repo> dsh-copy-file

# 2) 一键安装（幂等，可重复执行）
cd dsh-copy-file
powershell -ExecutionPolicy Bypass -File scripts/install.ps1
```

装完**重启一次 `dsh web`**，再刷新页面。

> 为什么必须重启：DSH 的配置热更可以"移除"一个行，但"新增一个此前没解析过的包"需要启动期解析，实测热更不生效（`window.__DSH_BOOT__` 里不会出现新行）。

### 它到底改了什么

只改你自己的 profile，**DSH 安装目录一个字节都不动**：

```
%USERPROFILE%\.dsh\profiles\web\
├─ package.json                    ← dsh.profile.bundles 末尾追加 "dsh-copy-file"
├─ node_modules\dsh-copy-file\     ← 这个包
└─ .dsh-copy-file\install.json     ← 安装记录（含安装前的 bundle 列表，用于精确回滚）
```

不需要 pnpm、不需要联网、不写注册表、不装服务、不设开机自启。

### 用法

聊天里让模型 `present` 一个文件 → 卡片右侧点箭头 → 选「复制文件」→ 到资源管理器 `Ctrl+V`。

---

## 卸载

```powershell
powershell -ExecutionPolicy Bypass -File scripts/uninstall.ps1
```

- 只从 `dsh.profile.bundles` **移除它自己那一项**（你之后手动加的其他 bundle 会保留，不会被"还原"掉）；
- 删除 `node_modules\dsh-copy-file` 和安装记录；
- 清理可能存在的 helper 进程与自启快捷方式（本版本默认都没有）。

刷新页面即可：实测**移除是即时生效的**，无需重启（`__DSH_BOOT__` 会回到只有 shipped 行，卡片恢复原生行为）。

---

## 校验

```powershell
powershell -ExecutionPolicy Bypass -File scripts/verify.ps1            # 已安装时
powershell -ExecutionPolicy Bypass -File scripts/verify.ps1 -ExpectAbsent   # 卸载后
```

检查项：包文件完整性、`lib/client.js` 是否与当前安装的 DSH 上游一致、profile 清单、以及 `dsh --profile web --dump-config` 里"我们的行存在 / 原生行被禁用"（卸载后反过来断言）。

自测（不需要 GUI）：

```powershell
node tests/clipboard.test.mjs   # 真机剪贴板：中文名/空格/引号/220 字符路径/多文件/缺文件
node tests/presented.test.mjs   # 坐标解析与拒绝分支
node tests/routes.test.mjs      # 四个路由 + 降级返回
node tests/client-bundle.test.mjs  # 浏览器半能加载、注册 6 个槽位与字典
```

> 跑 `node --test` 时如果 Node 在沙箱里无法 spawn 子进程，逐个文件跑即可（`node tests/xxx.test.mjs`）。

---

## 安全与隐私

| 关注点 | 做法 |
|---|---|
| 监听端口 | **不监听任何端口**。复制是一次性的 `powershell.exe -STA` 子进程，跑完即退 |
| 鉴权 | 复用 DSH 自己的登录 cookie + Host/Origin 栅栏（和 `present.open` 同一条通道），不引入第二个 token |
| 任意路径 | **路由没有 path 参数**。前端只能给 `sessionId / seq / index` |
| 越权访问 | 宿主从**只追加的会话日志**取声明，再经 Session 文件系统解析；还要 `processPathFromHostPath` 往返一致（同名文件冒充不了）；最终符号链接、目录、缺失文件都被拒 |
| 读写范围 | 不读文件内容（只 `stat` + 把路径交给系统 API）；不写系统目录；临时 JSON 用后即删 |
| 联网 | 不联网、无遥测、不上传任何东西 |
| 进程残留 | 子进程 8 秒超时强杀；卸载会清理 helper 与自启项 |

已知攻击面：能调用这些路由的前提是**已经登录这个本机 DSH**，也就是能打开这个网页的人。

---

## 兼容与升级

**只适配 DSH 0.2.0-rc.2**（`package.json` 里写死、`vendor-client.mjs` 会校验上游版本，不匹配直接拒绝生成）。

原因：原生下拉菜单没有"菜单项插槽"，要在它**内部**加行，唯一非侵入的做法是把上游那个浏览器包原样 vendored 过来、打 3 处增量 hunk，再用 bundle 行替换原行。这份 `lib/client.js` 是**生成物**：

```
src/copy-ui.js                 ← 全部新增代码（可读、可改）
lib/client.js                  ← 生成物，不要手改
scripts/vendor-client.mjs      ← 从你安装的 DSH 重新生成，锚点缺失/不唯一就报错
```

升级 DSH 后：

1. `node scripts/vendor-client.mjs --check` 会告诉你是否过期；
2. `node scripts/vendor-client.mjs` 重新生成（若上游改了锚点，它会**失败并指名**哪一处，不会产出半坏的包）；
3. 重跑 `scripts/install.ps1`，重启一次 `dsh web`。

两条已实测的行为差异：**新增行需要重启**，**移除行即时生效**。

---

## 上游建议

这个扩展之所以要 vendor 一份浏览器包，是因为原生下拉菜单没有"菜单项插槽"。
给上游的 issue 草稿在 [docs/upstream-issue.md](docs/upstream-issue.md)（能让以后不再需要 fork）。

---

## 已知限制

- **拖到资源管理器**只有 Chromium 可行（`DownloadURL`）。微信/飞书聊天窗口是否识别取决于它们自己；最稳的是先复制、再在目标里粘贴。
- **任务栏永远不接受文件拖放**：拖到任务栏图标上一定是"禁止"光标，任何来源（包括资源管理器自己）都一样。要落地请拖进**已打开文件夹的文件列表区**或桌面。
- `DownloadURL` 只认**文件系统落点**：Explorer 侧栏的文件夹图标、任务栏、微信/飞书窗口都会拒绝；拖动过程中 Windows **不会**自动把目标窗口提到前台，所以先把文件夹窗口露出来再拖。
- **原生拖拽出卡片**没有在真机窗口里完整复现（调试窗口不在前台时物理拖拽进不了页面）；`DownloadURL` 机制本身在独立页面实测成功（Edge 155，中文名原样落地）。页内"拖进对话"已用真实 dragstart+drop 验证。
- **路径超过 260 字符**：剪贴板本身能放，但个别粘贴目标可能截断。
- **会话工作区之外的文件**：与"打开文件"能力的边界一致，会被拒绝。
- **改名/移动文件**：会话日志不可变，卡片会指向旧路径 → 复制与预览都会失败；这时用「复制文件路径」仍可拿到路径（已实现并实测）。
- **原生应用列表很长**：那是上游行为（列出所有已注册应用），我们没动。
- macOS / Linux 未测试；Electron 桌面版未测试。

---

## 开发

```
lib/index.js         宿主半：四个已认证路由（copy.file / copy.path / copy.probe / copy.raw）
lib/presented.mjs    坐标 → 路径（含"声明路径"降级解析）
lib/clipboard.mjs    CF_HDROP 写入 + 回读校验（Windows 用 .NET Clipboard）
src/copy-ui.js       浏览器半的全部新增代码（菜单、选中、双击、Ctrl+C、拖拽）
cordis.patch.yml     bundle 补丁：禁用 ui-open-in-app，插入 dsh-copy-file 行
scripts/install.ps1  幂等安装（记录安装前状态）
scripts/uninstall.ps1 精确回滚
scripts/verify.ps1   只读校验（含 -ExpectAbsent）
```

几个踩过的坑（留给下一个改它的人）：

- `pwsh 7` **没有** `Set-Clipboard -Path`（只有 5.1 有），所以用 `System.Windows.Forms.Clipboard.SetFileDropList`，并且 `-STA`；
- 路径**不要**走命令行参数（中文/空格/引号/超长），走临时 UTF-8 JSON 文件；
- PowerShell 的 `ConvertFrom-Json` 对"数组"只回一个对象，`@(...)` 会套成嵌套数组——必须再过一个 `ForEach-Object` 展平；
- 控制台代码页会把中文路径变成 `?`，所以回读一律写 UTF-8 文件，不读 stdout；
- 要覆盖上游时，`id`、语言命名空间、槽位占用 id 都换成自己的，避免热切换瞬间重复注册抛错。

---

## License

MIT（见 [LICENSE](LICENSE)）。`lib/client.js` 是 `@deepseek-ai/dsh-client-ui-open-in-app`（MIT）的派生副本，归属声明见 [NOTICE](NOTICE)。

未经许可，仓库名、版权署名、截图请自行替换为你自己的。
