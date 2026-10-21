---
name: dsh-copy-file
description: Install, verify, or remove dsh-copy-file — a DSH Web GUI extension that copies the real file (not its path) from a delivery card to the system clipboard, and adds Windows-like card selection, double-click preview, Ctrl+C, and drag-to-conversation. Use when the user wants to paste a DSH-presented file into File Explorer, WeChat, Feishu, or a mail attachment, or asks to add a "copy file" action to DSH file cards.
---

# dsh-copy-file

A one-package DSH extension: a bundle row plus a vendored browser bundle. It never
modifies the DSH installation; it only adds a package to the user's profile and one
entry to `dsh.profile.bundles`.

## When to use this skill

Use it when the user says any of:

- "我只想复制这个文件本身，不想复制路径"
- "present 出来的卡片能不能直接复制到资源管理器 / 微信 / 飞书"
- "给 DSH 文件卡片加一个复制文件"
- or asks how to install / verify / uninstall `dsh-copy-file`.

Do not use it for plain clipboard text (DSH already copies paths from the Sidebar).

## Before you start

- Windows 11 + `dsh web` is the tested target. macOS/Linux code paths exist but are untested; say so instead of promising them.
- The repo must be pinned to DSH **0.2.0-rc.2**. `scripts/vendor-client.mjs` refuses any other upstream version.
- Ask before writing outside the workspace: installation edits `%USERPROFILE%\.dsh\profiles\web`, which a `workspace-write` sandbox blocks.

## Install

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install.ps1        # idempotent, records the pre-install state
```

Then tell the user to **restart `dsh web` once** and refresh the page. Adding a bundle row
that names a package the launcher has not resolved yet needs a restart; removing one applies live.

## Verify

```powershell
powershell -ExecutionPolicy Bypass -File scripts/verify.ps1
```

Expect eight PASS lines, including `our row is in the composition` and
`the shipped ui-open-in-app row is disabled`.

Functional checks, in order — do not skip them and do not claim success without output:

1. Open a Session that has delivery cards; click the card's chevron; the menu must list
   `复制文件`, `复制全部 N 个文件` (only when N > 1), `复制文件路径`, and keep
   `显示文件位置` last.
2. Click **复制文件**, then read the clipboard from PowerShell:
   `[System.Windows.Forms.Clipboard]::GetDataObject().GetFormats()` must contain `FileDrop`,
   and `GetFileDropList()` must return the exact absolute path.
   A text copy would show `UnicodeText`/`Text` instead — that is the failure worth catching.
3. Delete or rename the source file, click **复制文件** again: the toast must explain the
   degradation, and the clipboard must now hold the **path as text**.
4. Select a card (single click), press Ctrl+C: same `FileDrop` expectation.
5. Drag the card inside the page: the composer must gain an attachment chip.

## Uninstall

```powershell
powershell -ExecutionPolicy Bypass -File scripts/uninstall.ps1
powershell -ExecutionPolicy Bypass -File scripts/verify.ps1 -ExpectAbsent
```

The uninstaller restores the recorded bundle array, deletes the package, and removes the record.

## Safety facts to repeat accurately

- No port is opened; a copy is one `powershell.exe -STA` child that exits.
- Routes take only `sessionId` / `seq` / `index`; the Host resolves the path from the immutable Session log.
- Same authentication as `present.open` (login cookie + Host/Origin fence).
- No network, no telemetry, no file-content reads.
- Firefox/Safari: copying works, dragging out does not exist (no `DownloadURL`); the extension deliberately renders no drag source there.

## Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| Menu rows missing after install | `dsh web` not restarted | restart once, refresh |
| Whole split button gone | a JS error in the vendored bundle | ask for the first console error, then `scripts/uninstall.ps1` |
| `verify` reports `lib/client.js is stale` | DSH upgraded | `node scripts/vendor-client.mjs`, reinstall |
| Copy says "file is gone" | file renamed/moved; the Session log still names the old path | use **复制文件路径**, or re-present the file |
