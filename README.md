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

卡片右侧多一个**复制图标**。原来那组"打开方式"和"显示文件位置"一个都没动——它们还在原位、还是原来的按钮，我们只是**并排加了一个**：

| 动作 | 行为 |
|---|---|
| **单击图标** | 文件本体进剪贴板（CF_HDROP）。可以粘到资源管理器、微信、飞书、邮件附件区 |
| **右键图标**（`menu` 外观下是旁边的 chevron） | 「复制全部 N 个文件」（仅当 N > 1 时出现）与「复制文件路径」 |
| 失败时 | 自动降级为"复制路径"，并用 toast 说明**原因**（文件已被删除 / 剪贴板被占用 / 不支持的系统…），不会假装成功；如果连路径都写不进剪贴板，才显示「复制失败，请重试」 |

两种外观二选一（`config.presentation`，默认 `icon`）：

| `icon`（默认） | `menu` |
|---|---|
| 只有一个图标，右键出菜单 | 图标 + chevron，下拉出同一份菜单 |

卡片本身还获得 Windows 风格的交互（可选，默认开启）：

- **单击 = 选中**（底色直接用 DSH 自己的 hover 变深，没有发明新视觉）；
- **双击 = 在右侧栏打开预览**（Enter / Space 同样可以）；
- **选中后 `Ctrl+C` = 复制这个文件**；
- **拖动卡片**：跟随鼠标的半透明 ghost（DSH 现成文件图标 + 小字号文件名），
  - 在**页面内**松手 → 作为当前对话的附件（所有浏览器可用）；
  - 拖到**资源管理器**松手 → 落地一份副本（仅 Chromium）。

## 截图

后两张来自真实 `dsh web` 会话，并且**只裁到控件本身**，所以看不到工作区路径、会话标题或文件名。
第一张是 0.1.x 的旧外观（行在"打开方式"下拉里）——0.2.0 起改成卡片上的独立图标，图还没重拍：

| 0.1.x 的下拉菜单（历史） | 复制成功 | 降级提示 |
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

平台：**Windows 11**，已实测两种宿主：Electron 桌面版 **0.2.1-rc.3 / 0.2.2-rc.5** 与 `dsh web` **0.2.0-rc.2**。macOS / Linux 的代码路径已实现（`osascript` / `wl-copy`·`xclip`），**未测试**，不要当成品用。

---

## 安装

前提：Node 22.19+、**Windows PowerShell 5.1**（脚本自带 UTF-8 BOM，不需要 pwsh 7）、DSH **0.2.0-rc.2 及以上**（`dsh web` 或 Electron 桌面版均可；0.2.2-rc.5 上已验证）。

```powershell
# 1) 克隆到任意位置
git clone <this-repo> dsh-copy-file

# 2) 一键安装（幂等，可重复执行）
cd dsh-copy-file
powershell -ExecutionPolicy Bypass -File scripts/install.ps1
```

装完**完全退出 DSH 再启动**（桌面版退出 Electron 应用；Web 版重启 `dsh web`），然后打开一个有文件卡片的会话。

> 不传 `-Profile` 时脚本会自动探测：`profiles\desktop` 存在且 bundles 含 `@deepseek-ai/dsh-web-app` 就装到 `desktop`，否则回退 `web`。
> 桌面版独占自己的 profile，`dsh --dump-config` 在它上面不可用属预期——脚本会降级成提示，不影响安装。

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

检查项：包文件完整性、浏览器半的槽位契约（模块 id / 没有 vendor 上游 / 交付槽 / 补丁不禁用任何原生行 / 客户端自测）、profile 清单、以及 `dsh --profile <profile> --dump-config` 里"我们的行存在"。桌面版上该段会 SKIP，属预期。

自测（不需要 GUI）：

```powershell
node tests/clipboard.test.mjs   # 真机剪贴板：中文名/空格/引号/220 字符路径/多文件/缺文件
node tests/presented.test.mjs   # 坐标解析与拒绝分支
node tests/routes.test.mjs      # 四个路由 + 降级返回
node tests/client.test.mjs      # 浏览器半能加载、注册 2 个槽位、两份字典键一致
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

**兼容性是一个契约，不是一个版本号。** 浏览器半只依赖三件事：`deliverables.file.actions`
仍是 `kind: list` 的槽位；卡片仍往下传 `actionUrl / available / pending / onAction`；
卡片根节点仍带 `data-presented-file`。已在 **0.2.0-rc.2 / 0.2.1-rc.3 / 0.2.2-rc.5**
验证；更新的版本只要这三件事没变，就不需要适配。

为什么不再 vendor：原生下拉菜单确实没有"菜单项插槽"，但**卡片的动作区本身就是一个 list 槽位**，
往上挂第二个 occupant（`id: 'copy-file'`）就够了，不必替换上游那个包。0.2.2-rc.5 把上游
`ui-open-in-app/lib/client.js` 压成了单行：9 个拼接锚点里 7 个消失，`useDeliveryCard`
也不再存在于上游 —— 老方案在那里**已经无法重新生成**；而它的 `disabled: true` 仍然命中，
装上去会把整个新版 open-in-app 静默换回 0.2.1 的旧版（丢文件/图片/URL/工作区右键菜单、
在侧边栏与浮窗打开、Open locally 快捷键）。现在这条路径没有了。

两版外观，用 `config.presentation` 选（默认 `icon`）：

| 值 | 卡片上长什么样 |
|---|---|
| `icon` | 一个复制图标；单击复制，右键出"全部 / 路径" |
| `menu` | 同一个图标 + 一个 chevron，点开同一份菜单 |

切换不用重装，改 profile 的 `cordis.patch.yml` 即可：

```yaml
- id: dsh-copy-file
  config: { presentation: menu }
```

升级 DSH 后直接重装，没有生成步骤。万一哪天契约变了，症状是"卡片上没有复制图标"
（不是报错）；`scripts/verify.ps1` 的第 `[2]` 段和 `node tests/client.test.mjs` 会先告诉你。

两条已实测的行为差异：**新增行需要重启**，**移除行即时生效**。

---

## 上游

`docs/upstream-issue.md` 是 0.1.x 时代写的请求（给下拉菜单加"菜单项插槽"）。
0.2.x 的 `deliverables.file.actions` 已经是 list 槽位，这个请求对本项目不再必要，仅作历史保留。

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
lib/client.js        浏览器半（手写）：一个 occupant、两种外观、卡片交互
cordis.patch.yml     bundle 补丁：只插入 dsh-copy-file 一行，不禁用任何原生行
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
