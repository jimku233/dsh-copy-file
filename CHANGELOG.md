# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
