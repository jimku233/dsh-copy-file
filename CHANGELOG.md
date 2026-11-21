# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.2] — 2026-11-21

**拆成两个包**，装哪个用哪个：

| 包 | 卡片上 |
|---|---|
| `dsh-copy-file` | 复制图标 + 一个 chevron（默认版） |
| `dsh-copy-file-icon` | 只有一个复制图标，单击复制、右键出菜单 |

### Changed

- 移除了 0.2.1 里试过的运行时切换（菜单最后一行换外观、localStorage 记忆）—— 两版是**两份包**，
  不是一个包的两种状态。
- `icon/lib/` 由根目录的 `scripts/make-variant.mjs` 生成，只差两处（默认外观、客户端模块 id）。
  `tests/variant.test.mjs` 和 CI 的 `make-variant --check` 盯着它，落后就红。
- `install.ps1 -Variant icon` 装图标版；`uninstall.ps1` / `verify.ps1` 自动识别当前装的是哪个。
  两个包注册同一组 `api/copy.*` 路由，**互斥**：另一个已存在时安装直接拒绝并提示先卸载。

### Fixed

- 行配置选外观这条路**验证过不生效**：客户端插件的 `apply` 拿不到行配置（上游
  `dsh-client-locale`、`dsh-client-ui-chat` 也都从 `ctx.configForms` 读，不是从参数）。所以两版改成
  各自的打包默认值，不再依赖配置。
- `package.json` 的版本号补到 0.2.2（0.2.1 发版时漏改，文件里还写着 0.2.0）。

## [0.2.1] — 2026-11-21

### Fixed

- **复制按钮和右侧「打开」按钮贴在一起**：给复制这一组加了 8px 起始间距。
- 读外观配置时也看 `ctx.config`（仍然不够 —— 见 0.2.2）。

## [0.2.0] — 2026-11-21

**The browser half no longer replaces `ui-open-in-app`.** It registers one action of its
own into the delivery card's `deliverables.file.actions` slot, which the shipped
`ui-deliverables` declares as `kind: list`. Upstream is left untouched, so a DSH upgrade
can neither roll the shipped UI back nor break the extension by moving an anchor.

### Changed

- **New extension point.** `apply()` registers `{ name: 'deliverables.file.actions', id: 'copy-file' }`
  and the review-card twin, instead of a bundle patch that disabled `ui-open-in-app` and
  substituted a vendored copy. Verified against `0.2.2-rc.5`: its `ui-open-in-app/lib/client.js`
  is a single minified line, 7 of the 9 splice anchors were gone, and `useDeliveryCard` no
  longer existed upstream — the old pipeline could not regenerate at all.
- **Two presentations**, chosen by `config.presentation` (default `icon`): `icon` is one
  button (click copies, right-click opens the rest); `menu` adds a chevron next to it.
  Both share one code path; override the row in the profile patch to switch.
- `lib/client.js` is hand-written (~33 KB) instead of generated; the shipped upstream code
  is no longer copied into this repository. `scripts/vendor-client.mjs`, `src/copy-ui.js`
  and `tests/client-bundle.test.mjs` are removed; `tests/client.test.mjs` loads the bundle
  with a stub module table and asserts the module id, both slot occupants, and the
  dictionaries.
- `dsh.client.inject` shrinks from ten packages to `@deepseek-ai/dsh-client-ui-deliverables`.
- `install.ps1` no longer regenerates a bundle, and `verify.ps1` replaces the
  "matches the installed upstream bundle" check with a contract check: module id, no
  vendored upstream, the delivery slot, and a patch that never disables a shipped row.

### Fixed

- **Silent UI downgrade on 0.2.2.** `- id: ui-open-in-app / disabled: true` still matched
  the shipped row in `0.2.2-rc.5`, so installing 0.1.x there swapped in a `0.2.1`-era
  module and quietly removed the file / image / URL / workspace right-click menus, the
  open-in-sidebar and open-in-float rows, and the Open locally shortcut.
- Version pins. Support is stated as a slot contract rather than a version whitelist;
  `install.json` now records `dshOnPath` (observed) instead of `pinnedDsh`.

### Verified

- `node tests/client.test.mjs` → 5/5; the three Host test files unchanged and green.
- `verify.ps1 [2]` → module id, no vendored upstream, delivery slot, card interaction,
  a patch without `disabled: true`, and the client test all PASS.
- Not verified in this release: the installed profile still runs 0.1.2, so the new action
  has not been looked at in a live page yet. Reinstall and restart the app first.

## [0.1.2] — 2026-10-29

### Changed

- **`--dump-config` outcomes are now classified, not guessed** (same approach as `dsh-temp-sweep` v0.1.3):
  profile managed by the Electron app → expected step; row present → OK; sandbox `EPERM` → step;
  **empty output → skip**; row genuinely absent → warning. Previously an empty output and a sandbox
  refusal both fell into the misleading "the composed config does not list the row yet" warning.
- The closing hint branches on the managed profile ("quit the desktop app") versus a CLI profile
  ("stop `dsh web`"). It deliberately **does not** use `patchReload: live` to promise a restart-free
  activation: the client bundle is resolved at launch, so the first install always needs a restart —
  unlike `dsh-temp-sweep`, whose Host plugin really can activate live.

### Verified

- Windows PowerShell 5.1 `Parser::ParseFile` → 0 errors for all three scripts.
- `install.ps1 -Force` on `desktop` → managed profile classified as expected, copy succeeded, exit 0.
- `verify.ps1` → `[1][2][3]` PASS, `[4]` SKIP (Electron), exit 0.

## [0.1.1] — 2026-10-29

Works with the Electron build (DSH `0.2.1-rc.3`, `desktop` profile) as well as `0.2.0-rc.2` (`dsh web`).
`lib/client.js` is unchanged: the upstream `ui-open-in-app` bundle is identical in both releases
(`node scripts/vendor-client.mjs --check` → `lib/client.js is current.`).

### Fixed

- **`install.ps1` was broken in the repository** (shipped in 0.1.0): the version guard introduced in
  `b0b9bdb` truncated its closing quote, swallowing the rest of the file, and the whole tail section
  was duplicated. Windows PowerShell 5.1 failed with `Unexpected token 'regenerating'` /
  `The string is missing the terminator`. Rewritten without the duplicate tail.
- **Scripts are UTF-8 with BOM.** PowerShell 5.1 reads BOM-less scripts as ANSI and mis-parses the
  quotes; every `.ps1` now starts with `EF BB BF` and uses CRLF.
- **`$Home` parameter collision.** `Resolve-ProfileName([string]$Home)` threw
  `Cannot overwrite variable Home because it is read-only`; the parameter is now `$HarnessHome`.
- **`uninstall.ps1` no longer restores the recorded array.** It removes only its own entry from
  `dsh.profile.bundles`, so bundles added after installation survive — matching what the README
  already promised. `install.json.bundlesBefore` is kept, now used only for the report line.

### Added

- **Desktop profile support.** Without `-Profile`, the installer picks `desktop` when that profile
  exists and lists `@deepseek-ai/dsh-web-app`, otherwise falls back to `web`.
- **Electron-managed profile tolerated.** `dsh --dump-config` is exclusive to the Electron app on the
  `desktop` profile; install and verify now report that as a warning/SKIP instead of failing.
- **`SUPPORTED_VERSIONS` whitelist** (`0.2.0-rc.2`, `0.2.1-rc.3`) in `vendor-client.mjs`, and a
  `--check` failure caused by a *missing* local dsh install now degrades to a warning/SKIP — the
  committed `lib/client.js` is what gets installed on Electron-only machines.
- Docs: desktop install path, PowerShell 5.1 requirement, BOM rule, and the `--dump-config` caveat
  in both READMEs and in `CONTRIBUTING.md`.

### Verified

- `Parser::ParseFile` (Windows PowerShell 5.1) → 0 errors for all three scripts.
- `powershell -File scripts/install.ps1` → auto-detected `desktop`, `lib/client.js is current.`,
  copied 0.1.1, bundle kept last, dump-config downgraded to a warning, exit 0.
- `-Force` reinstall → same path exercised; `scripts/verify.ps1` → `[1][2][3]` PASS, `[4]` SKIP
  (Electron), exit 0.

## [0.1.0] — 2026-10-21

First release. Pinned to DSH `0.2.0-rc.2`; Windows 11 verified.

### Added

- **Cross-conversation drop**: dropping a card on a Session row in the sidebar switches to that
  conversation (waiting for the app's own `aria-selected`) and only then attaches the file, so a
  slow switch can never attach to the wrong conversation.
- **Single-attach guarantee**: one drag attaches exactly one file. The drop receiver is stored on
  `window` and replaces an older revision's receiver instead of stacking, `stopImmediatePropagation`
  silences the composer's sibling listener on `document`, and a 1.5-second claim keyed by the card's
  coordinates spans module instances.
- **Drag feedback**: when nothing accepted the drop (`dropEffect === 'none'`), a toast explains
  either how to succeed (Chromium) or that this browser cannot drag files out.
- The attached file keeps its real name and extension even when the menu was never opened (the name
  comes from the card's own resolved path).


- **Copy file** menu row: writes a real file list (`CF_HDROP`) through a short-lived
  `powershell.exe -STA` child that calls `System.Windows.Forms.Clipboard.SetFileDropList`
  and then reads the list back to confirm it.
- **Copy all N files**: every file of the same `present` call in one clipboard write;
  shown only when the delivery declares more than one file.
- **Copy file path**: the absolute path as text, including a *declared-path* resolver
  that keeps working after the file itself is deleted or renamed.
- **Automatic degradation**: a refused file copies its path instead and reports the reason
  in a non-blocking toast. Failure reasons are a stable wire contract
  (`file-missing`, `file-unavailable`, `clipboard-busy`, `verify-failed`, `timeout`,
  `unsupported-platform`, …).
- Windows-like card interaction, opt-in per card adapter: single click selects
  (reusing the card's own hover fill), double click opens the Sidebar preview,
  Enter/Space keep working, Ctrl+C copies the selected card's file.
- Drag with a translucent ghost built from the card's own file icon; dropping inside the
  page attaches the file to the conversation in every engine, and Chromium additionally
  carries `DownloadURL` so dropping on File Explorer lands a copy.
- `scripts/install.ps1`, `scripts/uninstall.ps1`, `scripts/verify.ps1` (idempotent,
  exact rollback, read-only verification with `-ExpectAbsent`).
- `scripts/vendor-client.mjs`: regenerates the vendored browser bundle from the installed
  DSH and fails loudly when an upstream anchor moved.
- Tests: real clipboard round-trips (CJK, spaces, quotes, 220-character path, multi-file,
  missing file, directory), coordinate resolution and refusals, the four host routes with
  the degraded response, and a headless load of the generated bundle.

### Verified on the reference machine

- Clipboard formats after **Copy file**: `FileDrop, FileNameW, FileName`; one file, exact path.
- **Copy all 2 files**: two files on the clipboard.
- **Copy file path**: `UnicodeText`/`Text` only, content is the absolute path.
- Select + Ctrl+C: same `FileDrop` expectation, no navigation on single click.
- Drag into the page: composer gains a `PDF 185KB` attachment from a drop that carried only
  `sessionId`/`seq`/`index`.
- Renaming the source file: toast reads
  `无法复制文件（文件已不可用），已改为复制路径` and the clipboard holds the path text.
- Uninstall: bundle list restored to its three entries, package and record removed,
  `verify -ExpectAbsent` all PASS, and a page reload returns the shipped menu.
- Dropping a card on another Session row: the row becomes `aria-selected="true"` and the target
  conversation's composer gains `简历…pdf / PDF 185KB`.
- One simulated drop adds exactly one composer chip (1 → 2).

### Known gaps

- Dragging out to File Explorer is Chromium-only; Firefox/Safari render no drag source.
- A native drag from a real card was not reproduced end to end (the debug window was not
  foreground); `DownloadURL` was verified on a standalone page.
- macOS, Linux and the Electron desktop app are untested.
- Renaming a delivered file makes the card stale by design (the Session log is immutable);
  the path fallback still works.
- The Windows taskbar never accepts file drops (any source), and `DownloadURL` only lands on a
  filesystem target — folder icons, taskbar buttons and other apps refuse it.
- Screenshots were removed from the repository: the captured frames came from a real session and
  contained personal paths and file names. `docs/screenshots/README.md` explains how to retake them.
