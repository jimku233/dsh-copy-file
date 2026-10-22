# 上游建议：给交付卡片的下拉菜单加一个"菜单项插槽"

> 这是一份可直接提交到 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness/issues) 的 issue 草稿。
> 正文按上游习惯用英文写，末尾附中文摘要。提交前请替换 `<你的仓库地址>` 等占位。

---

**Title:** `ui-open-in-app`: add a menu-item extension point to the delivery card action menu

**Labels (suggested):** `enhancement`, `client`, `plugin-api`

### Summary

The split button on a `present` delivery card (`deliverables.file.actions`) has no way to contribute a
**menu row**. A plugin can only render a *second control* next to it, which changes the card layout, or
replace the whole browser package — which is what we had to do.

We would like a supported slot for menu entries so that features like "copy this file to the OS
clipboard" (which needs a Host round-trip, see below) do not require vendoring
`@deepseek-ai/dsh-client-ui-open-in-app`.

### Why this is not already possible

`OpenTargetButton` builds its own `items` array from the file associations and its `footer` from the
reveal action:

```js
items: [...applications.map(...), ...props.failed ? [{ id: 'unavailable', ... }] : []],
footer: kind === 'file' ? [{ id: 'reveal', ... }] : [],
onSelect: (id) => { ... },
```

`FileRouteAction` (the adapter the delivery card mounts) receives only
`{ actionUrl, available, pending, onAction }` — no `items`, no children slot. The slot itself is
`{ kind: 'list' }`, so a second contribution becomes a second button rather than a menu row:

```
[ Open ▾ ] [ our button ]      ← layout change we are trying to avoid
```

### What we had to do instead

We generate a patched copy of the shipped browser bundle at install time
(`scripts/vendor-client.mjs` reads the installed `lib/client.js`, asserts 9 anchors, splices about
60 lines) and replace the `ui-open-in-app` row through a bundle patch. It works, but:

- it is pinned to one DSH release (`0.2.0-rc.2`) and must be re-vendored on every upgrade;
- a moved anchor aborts installation, which is honest but fragile;
- we ship 63.8 KB of upstream code we do not own in every install.

A menu-item slot would delete all of that.

### Proposed API (one option)

Extend `deliverables.file.actions` with a child slot for rows, declared by the owner and rendered by
`OpenTargetButton`:

```ts
// ui-deliverables: declared by the delivery card / review tab owner
'deliverables.file.menu': {
  kind: 'list';
  scope: 'session';
  owner: { actionUrl: string; available: boolean; pending: boolean };
};
```

`OpenTargetButton` renders contributions between its association rows and the reveal footer:

```
[ associated apps … ]
──── separator ────
[ contributed rows … ]
──── footer ────
[ show file location ]
```

A contribution would be a `{ id, label, icon?, disabled?, onSelect }` item built with the existing
`Menu` primitive, so hover, disabled state, keyboard navigation and both themes come for free.

Two smaller alternatives we would also accept:

1. `FileRouteAction` passes an `items` prop through to `OpenTargetButton` (owner-supplied rows);
2. `OpenTargetButton` accepts `extraItems`/`extraFooter` props and the card owner exposes them.

Any of the three keeps the split button's DOM, size and CSS untouched.

### Reference implementation

Our fork adds exactly this (three hunks, no structural change):

```js
// 1. OpenTargetButton
const copy = useCopyGesture(props.copy, t);              // no-op unless the caller opts in
items: [...copy.items, ...applications.map(...), ...],   // our rows first, then associations
onSelect: (id) => { if (copy.onSelect(id)) return; ... }, // our ids, then the shipped ids
children: [Menu, toast, copy.toast]                      // second toast seat

// 2. FileRouteAction (delivery card only; every other caller passes no copy)
copy: delivery.controller

// 3. locales: 25 keys in both dictionaries
```

Everything else is upstream code, untouched. Working implementation and tests:
`<你的仓库地址>` (MIT, `src/copy-ui.js` is the whole addition).

### Why the feature needs the Host

The concrete motivation is worth stating, because it explains why a page-only plugin cannot do it:
`Clipboard API` cannot write a **file list** (`CF_HDROP`) — only text and bitmaps. So the menu row must
call an authenticated Host route that resolves the delivered file and writes the OS clipboard. That
route is a normal `ctx.connection.fetch.register` route taking `sessionId`/`seq`/`index` (never a path),
so a menu row is all the browser side needs.

### Impact

- Plugins can add file actions without replacing shipped packages.
- No layout change for users; no second button.
- Existing callers (`session header`, `file tree`, `document preview`, `changed-file review`) keep their
  current menus because they simply contribute nothing to the new slot.

---

## 中文摘要

交付卡片右侧那个"打开方式"下拉菜单**没有菜单项扩展点**：插件只能在旁边再画一个按钮（改版式），
或者像我们这样整包 fork 上游浏览器半、每次升级重新生成。

建议加一个子槽（例如 `deliverables.file.menu`，`kind: 'list'`），让贡献的行渲染在"关联应用"和
"显示文件位置"之间；样式、键盘、暗色主题直接复用现有 `Menu`。这样"复制文件本体到系统剪贴板"
这类必须由宿主执行的功能就不用再 vendor 整个包了。我们的实现（3 处 hunk + 一个 60 行的片段）可以作为参考。
