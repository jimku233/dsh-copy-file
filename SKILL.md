---
name: dsh-copy-file
description: Install, verify, or remove dsh-copy-file — a DSH Web GUI extension that copies the real file (not its path) from a delivery card to the system clipboard, and adds Windows-like card selection, double-click preview, Ctrl+C, and drag-to-conversation. Use when the user wants to paste a DSH-presented file into File Explorer, WeChat, Feishu, or a mail attachment, or asks to add a "copy file" action to DSH file cards.
---

# dsh-copy-file

A one-package DSH extension: a bundle row plus a small hand-written browser module. It never
modifies the DSH installation; it only adds a package to the user's profile and one
entry to `dsh.profile.bundles`. The browser half adds one action of its own beside the
shipped "Open in" button and leaves that package enabled.

## When to use this skill

Use it when the user says any of:

- "我只想复制这个文件本身，不想复制路径"
- "present 出来的卡片能不能直接复制到资源管理器 / 微信 / 飞书"
- "给 DSH 文件卡片加一个复制文件"
- or asks how to install / verify / uninstall `dsh-copy-file`.

Do not use it for plain clipboard text (DSH already copies paths from the Sidebar).

## Before you start

- Windows 11 is the tested target. macOS/Linux code paths exist but are untested; say so instead of promising them.
- Compatibility is a contract, not a version: the browser half needs `deliverables.file.actions`
  to stay a `kind: list` slot that passes `actionUrl` / `available` / `pending` / `onAction`.
  Verified on `0.2.0-rc.2`, `0.2.1-rc.3` and `0.2.2-rc.5`; an unknown newer version is fine
  until that contract moves.
- Ask before writing outside the workspace: installation edits `%USERPROFILE%\.dsh\profiles\<name>`, which a `workspace-write` sandbox blocks.

## Install

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install.ps1        # idempotent, records the pre-install state
```

Then tell the user to **restart the app once** and refresh the page. Adding a bundle row
that names a package the launcher has not resolved yet needs a restart; removing one applies live.

The card shows one copy icon by default. To show a chevron next to it instead, add to the
profile's `cordis.patch.yml`:

```yaml
- id: dsh-copy-file
  config: { presentation: menu }
```

## Verify

```powershell
powershell -ExecutionPolicy Bypass -File scripts/verify.ps1
```

Expect PASS on `[1] package files`, `[2] browser half` (module id, no vendored upstream,
the delivery slot, card interaction, a patch that disables nothing, and the client test),
`[3] profile manifest`; `[4] composed configuration` is SKIP on the Electron profile by design.

Functional checks, in order — do not skip them and do not claim success without output:

1. Open a Session that has delivery cards. A copy icon must sit to the right of the card's
   "Open in" split button, and the split button must still be there with its own menu.
2. Click the copy icon, then read the clipboard from PowerShell:
   `[System.Windows.Forms.Clipboard]::GetDataObject().GetFormats()` must contain `FileDrop`,
   and `GetFileDropList()` must return the exact absolute path.
   A text copy would show `UnicodeText`/`Text` instead — that is the failure worth catching.
3. Right-click the copy icon (or use the chevron in `menu` mode): the menu must list
   `复制全部 N 个文件` (only when N > 1) and `复制文件路径`.
4. Delete or rename the source file, click the icon again: the toast must explain the
   degradation, and the clipboard must now hold the **path as text**.
5. Select a card (single click), press Ctrl+C: same `FileDrop` expectation.
6. Drag the card inside the page: the composer must gain an attachment chip.

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
| No copy icon after install | app not restarted | restart once, refresh |
| Icon present, "Open in" split button gone | an older release disabled `ui-open-in-app` | reinstall 0.2.0 or later; check `cordis.patch.yml` has no `disabled:` |
| Open-in menus (right-click, sidebar/float) missing | same cause: a 0.1.x install disabled the shipped row | reinstall 0.2.0, restart |
| `verify` reports the client test failing | a syntax or registration error in `lib/client.js` | run `node tests/client.test.mjs` and read the first failure |
| Copy says "file is gone" | file renamed/moved; the Session log still names the old path | use **复制文件路径**, or re-present the file |
