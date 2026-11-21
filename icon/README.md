# dsh-copy-file-icon

和 [`dsh-copy-file`](../README.md) **同一个功能、同一份代码**，只是卡片上只有一个复制图标：
单击复制文件，右键出「复制全部 N 个文件 / 复制文件路径」。

| | 卡片上长什么样 |
|---|---|
| [`dsh-copy-file`](../README.md)（默认版） | 复制图标 + 一个 chevron，点 chevron 出菜单 |
| **dsh-copy-file-icon**（本包） | 只有一个复制图标，右键出同一份菜单 |

**两个包互斥**：它们注册同一组 `api/copy.*` 路由，同时装会冲突。装了一个就不装另一个。

## 安装

在仓库根目录执行（脚本会自动装本包并做互斥检查）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install.ps1 -Variant icon
```

先卸掉另一个再装：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/uninstall.ps1
powershell -ExecutionPolicy Bypass -File scripts/install.ps1 -Variant icon
```

## 注意：这里的 `lib/` 是生成的

客户端 bundle 不能跨包 import，所以本包有自己的 `lib/`。它由仓库根的
`scripts/make-variant.mjs` 从 `../lib/` 生成，只差两处：

- `DEFAULT_PRESENTATION` 从 `'menu'` 改成 `'icon'`
- 客户端模块 id 从 `dsh-copy-file` 改成 `dsh-copy-file-icon`

**不要手改 `icon/lib/`**：改根目录的 `lib/`，然后

```powershell
node scripts/make-variant.mjs          # 重新生成
node scripts/make-variant.mjs --check  # 只检查是否落后（CI 用）
```

`tests/variant.test.mjs` 会拦住忘了重新生成的情况。

## 其它

安全模型、路由、降级行为、已知限制都与 [`dsh-copy-file`](../README.md) 完全相同 —— 那是同一份代码。
